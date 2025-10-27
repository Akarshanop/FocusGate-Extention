document.addEventListener('DOMContentLoaded', () => {
    const loginView = document.getElementById('login-view');
    const loggedInView = document.getElementById('loggedin-view');
    const loginForm = document.getElementById('login-form');
    const logoutBtn = document.getElementById('logout-btn');
    const testOverlayBtn = document.getElementById('test-overlay-btn');
    const testOverlayAnywayBtn = document.getElementById('test-overlay-anyway');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    let statusMessage = document.getElementById('status-message');
    if (!statusMessage) {
        statusMessage = document.createElement('p');
        statusMessage.id = 'status-message';
        loginForm.after(statusMessage);
    }

    const showLoginView = () => {
        loginView.style.display = 'block';
        loggedInView.style.display = 'none';
        emailInput.value = '';
        passwordInput.value = '';
        statusMessage.textContent = '';
    };

    const showLoggedInView = () => {
        loginView.style.display = 'none';
        loggedInView.style.display = 'block';
        statusMessage.textContent = '';
    };

    chrome.runtime.sendMessage({ action: 'checkAuth' }, (response) => {
        if (response && response.loggedIn) {
            showLoggedInView();
        } else {
            showLoginView();
        }
    });

    loginForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const email = emailInput.value;
        const password = passwordInput.value;

        statusMessage.textContent = 'Logging in...';
        statusMessage.style.color = 'gray';

        chrome.runtime.sendMessage(
            { action: 'login', payload: { email, password } },
            (response) => {
                if (!response) {
                    statusMessage.textContent = 'Error: No response from extension.';
                    statusMessage.style.color = 'red';
                    return;
                }
                if (response.success) {
                    showLoggedInView();
                } else {
                    statusMessage.textContent = response.message || 'Login failed.';
                    statusMessage.style.color = 'red';
                }
            }
        );
    });

    logoutBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'logout' }, (response) => {
            if (response && response.success) {
                showLoginView();
            }
        });
    });

    function triggerOverlayOnActiveTab(payload) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || !tab.id) return;
            chrome.tabs.sendMessage(tab.id, { action: 'ask_question', payload }, () => { });
        });
    }

    function samplePayload() {
        return {
            requestId: `${Date.now()}`,
            question: 'Which format do you want to try?',
            type: 'mcq',
            options: ['MCQ', 'True/False', 'Short Answer', 'Numerical']
        };
    }

    testOverlayBtn?.addEventListener('click', () => {
        triggerOverlayOnActiveTab(samplePayload());
    });

    testOverlayAnywayBtn?.addEventListener('click', () => {
        triggerOverlayOnActiveTab({
            requestId: `${Date.now()}-num`,
            question: 'What is 6 × 7?',
            type: 'numerical',
            correctAnswer: 42
        });
    });
    document.getElementById('language-select')?.addEventListener('change', (e) => {
        const lang = e.target.value;
        chrome.runtime.sendMessage({ action: 'setLanguage', lang }, (resp) => {
            if (resp?.success) {
                alert(`Language changed to ${lang.toUpperCase()}`);
            }
        });
    });
});


