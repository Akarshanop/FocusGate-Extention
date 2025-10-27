/********************************************************************
 *  FocusGate AI Edition — Chrome Built-in AI Integration (Safe Version)
 *  Features:
 *   1️⃣ Uses Prompt API (Gemini Nano) for dynamic question generation.
 *   2️⃣ Uses Translator API for user-preferred language support.
 *   3️⃣ Adds safety checks for when AI APIs aren't defined.
 *   4️⃣ Keeps full compatibility with your existing overlay UI.
 ********************************************************************/

let userBlocklist = [];
const temporarilyUnblocked = new Map();

/* ------------------------------------------------------------------
   🧭 Load User Blocklist (same as before)
------------------------------------------------------------------ */
async function fetchBlocklist() {
  const result = await chrome.storage.sync.get(['authToken']);
  const token = result.authToken;

  if (!token) {
    userBlocklist = [];
    console.log('User not logged in. Blocker inactive.');
    return;
  }

  try {
    const response = await fetch('http://localhost:3000/api/sites', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Server responded ${response.status}`);

    const sites = await response.json();
    userBlocklist = sites.map((s) => s.url);
    console.log('FocusGate AI active with sites:', userBlocklist);
  } catch (err) {
    console.error('Blocklist fetch error:', err);
    userBlocklist = [];
  }
}

/* ------------------------------------------------------------------
   🤖 AI Helpers — Built-in Prompt & Translator APIs (Safe)
------------------------------------------------------------------ */

// ✅ Generate a question using Gemini Nano (Prompt API)
async function generateAIQuestion(topic = 'focus and productivity') {
  try {
    // 🧩 Safety check for `ai` availability
    if (typeof ai === 'undefined' || !ai.languageModel) {
      console.warn('Built-in AI APIs not available. Using fallback question.');
      return {
        question: 'What is 2 + 2?',
        type: 'numerical',
        correctAnswer: 4
      };
    }

    const availability = await ai.languageModel.capabilities();
    if (availability.available !== 'readily') {
      console.warn('Gemini Nano not ready locally:', availability);
      return {
        question: 'What is 2 + 2?',
        type: 'numerical',
        correctAnswer: 4
      };
    }

    const session = await ai.languageModel.create({ model: 'gemini-nano' });

    const prompt = `
    Create a JSON object with a single multiple-choice question related to ${topic}.
    Example format:
    {"question":"...", "options":["...","...","...","..."], "correctAnswer":"..."}
    Keep question short and positive.`;

    const result = await session.prompt(prompt);
    const output = result.text().trim();
    console.log('Prompt API output:', output);

    // Try to parse JSON safely
    const match = output.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    return {
      question: parsed.question || 'Which action helps improve focus?',
      type: 'mcq',
      options: parsed.options || ['Procrastination', 'Meditation', 'Scrolling', 'Multitasking'],
      correctAnswer: parsed.correctAnswer || 'Meditation'
    };
  } catch (err) {
    console.error('Prompt API error:', err);
    return {
      question: 'Focus question: What is 5 × 5?',
      type: 'numerical',
      correctAnswer: 25
    };
  }
}

// ✅ Translate text into user’s preferred language (Translator API)
async function translateText(text, targetLang = 'en') {
  try {
    // 🧩 Safety check for Translator API
    if (typeof ai === 'undefined' || !ai.translator) {
      console.warn('Translator API not available. Returning original text.');
      return text;
    }

    const translator = await ai.translator.create({
      sourceLanguage: 'en',
      targetLanguage: targetLang
    });
    const result = await translator.translate(text);
    return result.text;
  } catch (err) {
    console.warn('Translator fallback:', err);
    return text; // fallback to English
  }
}

/* ------------------------------------------------------------------
   🚦 Main Tab Logic — Trigger on Blocked Sites
------------------------------------------------------------------ */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (userBlocklist.length === 0) return;

  const domain = new URL(tab.url).hostname;
  if (temporarilyUnblocked.has(domain)) return;

  const isBlocked = userBlocklist.some((p) => new RegExp(p).test(tab.url));
  if (!isBlocked) return;

  console.log(`FocusGate: Blocked domain detected → ${domain}`);

  // 🧠 Generate AI Question
  const aiQuestion = await generateAIQuestion();

  // 🌐 Translate question & options
  const { preferredLang = 'en' } = await chrome.storage.sync.get('preferredLang');
  aiQuestion.question = await translateText(aiQuestion.question, preferredLang);
  if (Array.isArray(aiQuestion.options)) {
    aiQuestion.options = await Promise.all(
      aiQuestion.options.map((opt) => translateText(opt, preferredLang))
    );
  }

  // 🚀 Send question payload to overlay
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'show_overlay',
      payload: {
        requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...aiQuestion
      }
    });
  } catch (err) {
    console.warn('Could not send overlay message:', err);
  }
});

/* ------------------------------------------------------------------
   💬 Runtime Message Handling (login/logout/language/overlay)
------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'login') {
    fetch('http://localhost:3000/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.payload)
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.token) {
          chrome.storage.sync.set({ authToken: data.token }, () => {
            fetchBlocklist();
            sendResponse({ success: true });
          });
        } else {
          sendResponse({ success: false, message: data.message });
        }
      })
      .catch((err) => {
        console.error('Login error:', err);
        sendResponse({ success: false, message: 'Cannot connect to server.' });
      });
    return true;
  }

  if (req.action === 'checkAuth') {
    chrome.storage.sync.get(['authToken'], (r) =>
      sendResponse({ loggedIn: !!r.authToken })
    );
    return true;
  }

  if (req.action === 'logout') {
    chrome.storage.sync.remove('authToken', () => {
      userBlocklist = [];
      console.log('User logged out. Blocker inactive.');
      sendResponse({ success: true });
    });
    return true;
  }

  if (req.action === 'overlay_answer') {
    console.log('Overlay answered:', req.payload);
    sendResponse?.({ status: 'received' });
    return true;
  }

  // 🌍 Change preferred language
  if (req.action === 'setLanguage') {
    chrome.storage.sync.set({ preferredLang: req.lang });
    console.log('Preferred language updated →', req.lang);
    sendResponse({ success: true });
    return true;
  }
});

fetchBlocklist();
