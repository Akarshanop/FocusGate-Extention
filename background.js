let userBlocklist = [];
const temporarilyUnblocked = new Map();

async function fetchBlocklist() {
    const result = await chrome.storage.sync.get(['authToken']);
    const token = result.authToken;

    if (!token) {
        userBlocklist = [];
        console.log('User not logged in. Blocker is inactive.');
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/api/sites', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        
        const sitesArrayOfObjects = await response.json();
        userBlocklist = sitesArrayOfObjects.map(site => site.url);
        
        console.log('Blocker is now active with list:', userBlocklist);
    } catch (error) {
        console.error('Could not fetch blocklist:', error);
        userBlocklist = [];
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        if (userBlocklist.length === 0) {
            return;
        }

        const url = new URL(tab.url);
        const domain = url.hostname;

        if (temporarilyUnblocked.has(domain)) {
            return;
        }

        const isBlocked = userBlocklist.some(pattern => new RegExp(pattern).test(tab.url));

        if (isBlocked) {
            // Ask a simple question when a blocked site is opened.
            chrome.tabs.sendMessage(tabId, {
                action: "show_overlay",
                payload: {
                    requestId: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
                    question: "Pick the correct spelling:",
                    type: "mcq",
                    options: ["Recieve", "Receive", "Receeve", "Recive"],
                    correctAnswer: "Receive"
                }
            });
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'login') {
        fetch('http://localhost:3000/api/users/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        })
        .then(response => response.json())
        .then(data => {
            if (data.token) {
                chrome.storage.sync.set({ authToken: data.token }, () => {
                    fetchBlocklist();
                    sendResponse({ success: true });
                });
            } else {
                sendResponse({ success: false, message: data.message });
            }
        })
        .catch(error => {
            console.error('Login fetch error:', error);
            sendResponse({ success: false, message: 'Cannot connect to server.' });
        });
        return true;
    }
    
    else if (request.action === 'checkAuth') {
        chrome.storage.sync.get(['authToken'], (result) => {
            sendResponse({ loggedIn: !!result.authToken });
        });
        return true;
    }
    
    else if (request.action === 'logout') {
        chrome.storage.sync.remove('authToken', () => {
            userBlocklist = [];
            console.log('User logged out. Blocker is now inactive.');
            sendResponse({ success: true });
        });
        return true;
    }
    
    else if (request.action === 'overlay_answer') {
        const { requestId, payload } = request;
        console.log('Overlay answered:', { requestId, payload, fromTab: sender.tab?.id });
        sendResponse?.({ status: 'received' });
        return true;
    }
});

fetchBlocklist();