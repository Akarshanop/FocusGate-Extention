
let userBlocklist = [];
const temporarilyUnblocked = new Map();

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
      headers: { Authorization: `Bearer ${token}` },
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

async function fetchQuestionSettings() {
  try {
    const result = await chrome.storage.sync.get(['authToken']);
    const token = result.authToken;
    if (!token) throw new Error('User not authenticated');

    const res = await fetch('http://localhost:3000/api/meta', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`Meta settings fetch failed ${res.status}`);
    const metas = await res.json();
    if (!metas || metas.length === 0) throw new Error('No user settings found');

    const latestMeta = metas[0];
    return {
      exam: latestMeta.exam || 'General',
      topic: latestMeta.topic || 'focus',
      difficulty: latestMeta.difficulty || 'medium',
      format: latestMeta.format || 'mcq',
      frequency: latestMeta.frequency || 5,
    };
  } catch (err) {
    console.warn('Could not fetch question settings:', err.message);
    return {
      exam: 'General',
      topic: 'focus',
      difficulty: 'medium',
      format: 'mcq',
      frequency: 5,
    };
  }
}

async function generateAIQuestion(exam, topic, difficulty) {
  try {
    const aiModel = self.LanguageModel || chrome.ai?.languageModel;
    if (!aiModel) {
      console.warn('Prompt API not available, using fallback.');
      return {
        question: 'What is 2 + 2?',
        options: ['3', '4', '5', '6'],
        correctAnswer: '4',
        type: 'mcq'
      };
    }

    const availability = await aiModel.availability({});
    console.log('AI Model availability:', availability);
    if (availability !== 'available' && availability !== 'downloadable') {
      console.warn('Gemini Nano not ready:', availability);
      return {
        question: 'What is 2 + 2?',
        options: ['3', '4', '5', '6'],
        correctAnswer: '4',
        type: 'mcq'
      };
    }

    const session = await aiModel.create({ temperature: 0.7, topK: 40 });
    const prompt = `
    Create ONE JSON multiple-choice question for exam "${exam}".
    Topic: "${topic}", Difficulty: "${difficulty}".
    Output ONLY JSON like this:
    {"question":"...", "options":["...","...","...","..."], "correctAnswer":"..."}
    `;

    const output = await session.prompt(prompt);
    console.log('🧠 Raw AI output:', output);

    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}') + 1;
    let parsed = {};
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      let rawJson = output.substring(jsonStart, jsonEnd);

      // sanitize
      rawJson = rawJson
        .replace(/[\r\n]+/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
        .trim();

      try {
        parsed = JSON.parse(rawJson);
        console.log('✅ Parsed AI JSON:', parsed);
      } catch (err) {
        console.warn('❌ JSON parse error:', err.message);
        console.warn('Sanitized JSON string:', rawJson);
      }
    }

    if (!parsed.question || !Array.isArray(parsed.options)) {
      parsed = {
        question: `Sample ${difficulty} question on ${topic}?`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correctAnswer: 'Option A',
      };
      console.warn('⚠️ Using fallback parsed question:', parsed);
    }

    parsed.type = 'mcq';
    return parsed;
  } catch (err) {
    console.error('AI Error:', err);
    return {
      question: `Focus question: What is 5 × 5?`,
      options: ['20', '25', '30', '35'],
      correctAnswer: '25',
      type: 'numerical'
    };
  }
}

async function translateText(text, targetLang = 'en') {
  try {
    const translatorApi = self.Translator || chrome.ai?.translator;
    if (!translatorApi) return text;

    const avail = await translatorApi.availability({ sourceLanguage: 'en', targetLanguage: targetLang });
    if (avail !== 'available' && avail !== 'downloadable') return text;

    const result = await translatorApi.translate({ text, target: targetLang, source: 'en' });
    return result.text;
  } catch {
    return text;
  }
}

async function getSessionDuration() {
  const settings = await fetchQuestionSettings();
  return (settings.frequency || 5) * 60 * 1000;
}

async function getSessionExpiry(domain) {
  const data = await chrome.storage.session.get(domain);
  return data[domain];
}
async function setSessionExpiry(domain, expiry) {
  await chrome.storage.session.set({ [domain]: expiry });
}
async function removeSession(domain) {
  await chrome.storage.session.remove(domain);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (userBlocklist.length === 0) return;

  const domain = new URL(tab.url).hostname;
  const session = await getSessionExpiry(domain);
  if (session && Date.now() < session) return; // still unlocked
  if (session) await removeSession(domain);

  const isBlocked = userBlocklist.some((p) => new RegExp(p).test(tab.url));
  if (!isBlocked) return;

  console.log(`🚫 FocusGate blocked domain → ${domain}`);

  const settings = await fetchQuestionSettings();
  let aiQuestion = await generateAIQuestion(settings.exam, settings.topic, settings.difficulty);

  const { preferredLang = 'en' } = await chrome.storage.sync.get('preferredLang');
  aiQuestion.question = await translateText(aiQuestion.question, preferredLang);

  try {
    console.log('🟣 Sending overlay to tab with question:', aiQuestion);
    const sendResult = await chrome.tabs.sendMessage(tabId, {
      action: 'show_overlay',
      payload: {
        requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...aiQuestion,
      },
    });
    console.log('🟢 Overlay message dispatched:', sendResult);
  } catch (err) {
    console.error('❌ Could not send overlay message:', err);

    // Fallback: manually inject overlay.js & css if not already loaded
    console.warn('⚙️ Injecting overlay script manually as fallback.');
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['overlay.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
      // Re-send after injection
      await chrome.tabs.sendMessage(tabId, {
        action: 'show_overlay',
        payload: aiQuestion,
      });
      console.log('✅ Overlay injected and re-sent.');
    } catch (injErr) {
      console.error('🚨 Overlay injection failed:', injErr);
    }
  }
});

chrome.runtime.onMessage.addListener(async (req, sender, sendResponse) => {
  if (req.action === 'overlay_answer') {
    const domain = new URL(sender.tab.url).hostname;
    if (req.payload.correct) {
      const duration = await getSessionDuration();
      const expiry = Date.now() + duration;
      await setSessionExpiry(domain, expiry);
      temporarilyUnblocked.set(domain, expiry);
      console.log(`✅ Unlocked ${domain} for ${(duration / 60000).toFixed(1)} mins`);
    } else {
      console.log(`❌ Incorrect answer for ${domain}, remains blocked.`);
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (req.action === 'setLanguage') {
    await chrome.storage.sync.set({ preferredLang: req.lang });
    console.log('🌐 Language updated →', req.lang);
    sendResponse({ success: true });
    return true;
  }

  return true;
});

fetchBlocklist();
