let userBlocklist = [];
let userQuesitons = [];
const temporarilyUnblocked = new Map();

async function fetchBlocklist() {
    const result = await chrome.storage.sync.get(['authToken']);
    const token = result.authToken;
    // ... (rest of fetchBlocklist remains the same)
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

async function fetchquestions(){
    const result = await chrome.storage.sync.get(['authToken']);
    const token = result.authToken;
    if (!token) {
        userQuestions = [];
        console.log('User not logged in. Blocker inactive.');
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/api/questions', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`Server responded ${response.status}`);

        const sites = await response.json();
        userQuestions = sites.map((s) => s.url);
        console.log('FocusGate AI active with sites:', userQuestions);
    } catch (err) {
        console.error('Questions fetch error:', err);
        userQuesitons = [];
    }    
}

async function generateAIQuestion(topic = 'focus and productivity') {
    try {
        const aiModel = self.LanguageModel || chrome.ai?.languageModel;

        if (!aiModel) {
            console.warn('Built-in AI Prompt API not available. Using fallback question.');
            return { question: 'What is 2 + 2?', type: 'numerical', correctAnswer: '4' };
        }
        
        const availability = await aiModel.availability({}); // Still requires an empty object
        
        if (availability !== "available" && availability !== "downloadable") {
            console.warn('Gemini Nano not ready locally:', availability);
            return { question: 'What is 2 + 2?', type: 'numerical', correctAnswer: '4' };
        }

        const session = await aiModel.create({
            temperature: 0.8,
            topK: 50
        }); 

        const prompt = `
        Create a single, short JSON object related to ${topic} for a multiple-choice question. 
        The JSON must only contain the object: {"question":"...", "options":["...","...","...","..."], "correctAnswer":"..."}`;

        const output = await session.prompt(prompt); 
        
        console.log('Prompt API raw output:', output.trim());

        if (!output || output.length < 10 || !output.includes('{')) { 
            throw new Error(`AI returned unusable output, falling back.`);
        }

        const jsonStart = output.indexOf('{');
        const jsonEnd = output.lastIndexOf('}') + 1;
        let parsed = {};

        if (jsonStart !== -1 && jsonEnd > jsonStart) {
            try {
                const jsonString = output.substring(jsonStart, jsonEnd);
                parsed = JSON.parse(jsonString);
            } catch (e) {
                console.error('Failed to parse JSON from AI output:', e);
            }
        }

        return {
          question: parsed.question || 'Which action helps improve focus?',
          type: 'mcq',
          options: parsed.options || ['Procrastination', 'Meditation', 'Scrolling', 'Multitasking'],
          correctAnswer: String(parsed.correctAnswer || 'Meditation')
        };
    } catch (err) {
        console.error(`Prompt API error: ${err.name || 'Unknown Error'}: ${err.message}`, err);
        return {
            question: 'Focus question: What is 5 × 5?',
            type: 'numerical',
            correctAnswer: '25'
        };
    }
}

async function translateText(text, targetLang = 'en') {
    try {
        const translatorApi = self.Translator || chrome.ai?.translator; 
        
        if (!translatorApi) {
            console.warn('Translator API not available. Returning original text.');
            return text;
        }

        const availability = await translatorApi.availability({
            sourceLanguage: 'en',
            targetLanguage: targetLang
        }); 
        
        if (availability !== "available" && availability !== "downloadable") {
            console.warn('Translator model not ready. Returning original text.');
            return text;
        }

        const result = await translatorApi.translate({
            text: text,
            target: targetLang,
            source: 'en'
        });
        
        return result.text;
    } catch (err) {
        console.warn(`Translator fallback: Generic API error. ${err.name || 'Unknown Error'}: ${err.message}`, err);
        return text; 
    }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    if (userBlocklist.length === 0) return;

    const domain = new URL(tab.url).hostname;
    if (temporarilyUnblocked.has(domain) && temporarilyUnblocked.get(domain) > Date.now()) return;

    const isBlocked = userBlocklist.some((p) => new RegExp(p).test(tab.url));
    if (!isBlocked) return;

    console.log(`FocusGate: Blocked domain detected → ${domain}`);

    const aiQuestion = await generateAIQuestion(domain); 

    const { preferredLang = 'en' } = await chrome.storage.sync.get('preferredLang');
    
    aiQuestion.question = await translateText(aiQuestion.question, preferredLang);
    
    if (Array.isArray(aiQuestion.options)) {
        aiQuestion.options = await Promise.all(
            aiQuestion.options.map((opt) => translateText(opt, preferredLang))
        );
    }
    
    aiQuestion.correctAnswer = await translateText(aiQuestion.correctAnswer, preferredLang);
    

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

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'overlay_answer') {
        console.log('Overlay answered:', req.payload);
        
        const domain = new URL(sender.tab.url).hostname;
        if (req.payload.correct) {
            temporarilyUnblocked.set(domain, Date.now() + 30 * 60 * 1000); 
        }
        sendResponse?.({ status: 'received' });
        return true;
    }

    if (req.action === 'setLanguage') {
        chrome.storage.sync.set({ preferredLang: req.lang });
        console.log('Preferred language updated →', req.lang);
        sendResponse({ success: true });
        return true;
    }
    
    if (req.action === 'login' || req.action === 'checkAuth' || req.action === 'logout') {
        return true;
    }
});

fetchBlocklist();