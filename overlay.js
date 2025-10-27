
(() => {
  // If already injected once, don't duplicate.
  if (document.getElementById('focusgate-overlay')) {
    return;
  }

  // Create overlay container and DOM structure.
  const overlay = document.createElement('div');
  overlay.id = 'focusgate-overlay';
  overlay.style.display = 'none';

  const content = document.createElement('div');
  content.className = 'focusgate-content-wrapper';
  content.setAttribute('role', 'dialog');
  content.setAttribute('aria-modal', 'true');

  const title = document.createElement('h1');
  title.id = 'fg-title';
  title.className = 'focusgate-title';
  title.textContent = 'FocusGate — Reduce Distractions';

  const message = document.createElement('p');
  message.className = 'focusgate-message';
  message.textContent = 'Answer the question to continue.';

  const qaArea = document.createElement('div');
  qaArea.className = 'focusgate-ai-question-area';

  const qText = document.createElement('div');
  qText.id = 'fg-question-text';
  qText.className = 'fg-question-text';
  qText.textContent = 'Question will appear here…';

  const form = document.createElement('form');
  form.id = 'fg-answer-form';
  form.className = 'fg-answer-form';
  form.noValidate = true;

  const answerArea = document.createElement('div');
  answerArea.id = 'fg-answer-area';

  const feedback = document.createElement('div');
  feedback.id = 'fg-feedback';
  feedback.className = 'fg-feedback';
  feedback.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'fg-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.id = 'fg-submit';
  submitBtn.className = 'fg-btn fg-primary';
  submitBtn.textContent = 'Submit';

  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.id = 'fg-continue';
  continueBtn.className = 'fg-btn fg-success';
  continueBtn.textContent = 'Continue';
  continueBtn.disabled = true;

  actions.appendChild(submitBtn);
  actions.appendChild(continueBtn);

  form.appendChild(answerArea);
  form.appendChild(feedback);
  form.appendChild(actions);

  qaArea.appendChild(qText);
  qaArea.appendChild(form);

  content.appendChild(title);
  content.appendChild(message);
  content.appendChild(qaArea);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  // Focus management helper.
  function trapFocus() {
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const nodes = overlay.querySelectorAll(focusableSelectors);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      if (e.key === 'Escape') {
        hideOverlay();
      }
    });
  }

  // State
  let pendingRequest = null; // { question, type, options, correctAnswer?, allowSkip? }

  // Renderers for different question types
  function renderMCQ(options = []) {
    answerArea.innerHTML = '';
    if (!Array.isArray(options) || options.length === 0) {
      const warn = document.createElement('div');
      warn.textContent = 'No options provided.';
      answerArea.appendChild(warn);
      return;
    }
    const list = document.createElement('div');
    list.className = 'fg-options';
    options.forEach((opt, idx) => {
      const id = `fg-opt-${idx}`;
      const label = document.createElement('label');
      label.className = 'fg-option';
      label.setAttribute('for', id);

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'fg-answer';
      input.id = id;
      input.value = String(opt);

      const span = document.createElement('span');
      span.textContent = String(opt);

      label.appendChild(input);
      label.appendChild(span);
      list.appendChild(label);
    });
    answerArea.appendChild(list);
  }

  function renderTrueFalse() {
    renderMCQ(['True', 'False']);
  }

  function renderShortAnswer(placeholder = 'Type your answer…') {
    answerArea.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fg-text';
    input.className = 'fg-input';
    input.placeholder = placeholder;
    answerArea.appendChild(input);
  }

  function renderNumerical(placeholder = 'Enter a number…') {
    answerArea.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.id = 'fg-number';
    input.className = 'fg-input';
    input.placeholder = placeholder;
    answerArea.appendChild(input);
  }

  function getUserAnswer(type) {
    switch (type) {
      case 'mcq': {
        const checked = answerArea.querySelector('input[name="fg-answer"]:checked');
        return checked ? checked.value : null;
      }
      case 'truefalse': {
        const checked = answerArea.querySelector('input[name="fg-answer"]:checked');
        return checked ? checked.value.toLowerCase() : null;
      }
      case 'short': {
        const v = (answerArea.querySelector('#fg-text')?.value || '').trim();
        return v.length ? v : null;
      }
      case 'numerical': {
        const raw = (answerArea.querySelector('#fg-number')?.value || '').trim();
        if (raw === '') return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      default:
        return null;
    }
  }

  function setFeedback(text, tone = 'info') {
    feedback.textContent = text || '';
    feedback.classList.remove('fg-ok', 'fg-err', 'fg-info');
    if (tone === 'ok') feedback.classList.add('fg-ok');
    else if (tone === 'err') feedback.classList.add('fg-err');
    else feedback.classList.add('fg-info');
  }

  function showOverlay() {
    overlay.style.display = 'flex';
    setTimeout(() => {
      const firstInput = overlay.querySelector('input, button');
      if (firstInput) firstInput.focus();
    }, 0);
    trapFocus();
  }

  function hideOverlay() {
    overlay.style.display = 'none';
    form.reset();
    feedback.textContent = '';
  }

  function renderQuestion(payload) {
    // payload: { question: string, type: 'mcq'|'truefalse'|'short'|'numerical', options?: string[], placeholder?, allowSkip?, correctAnswer? }
    pendingRequest = payload || null;
    if (!payload || !payload.question || !payload.type) {
      qText.textContent = 'Invalid question payload.';
      answerArea.innerHTML = '';
      return;
    }
    qText.textContent = String(payload.question);
    setFeedback('');
    continueBtn.disabled = true;

    switch (String(payload.type).toLowerCase()) {
      case 'mcq':
        renderMCQ(payload.options || []);
        break;
      case 'truefalse':
      case 'true/false':
        renderTrueFalse();
        break;
      case 'short':
      case 'shortanswer':
        renderShortAnswer(payload.placeholder);
        break;
      case 'numerical':
      case 'numeric':
      case 'number':
        renderNumerical(payload.placeholder);
        break;
      default:
        answerArea.textContent = 'Unsupported question type.';
        break;
    }

    showOverlay();
  }

  // Form submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!pendingRequest) {
      setFeedback('No question to answer.', 'err');
      return;
    }
    const type = String(pendingRequest.type).toLowerCase();
    const answer = getUserAnswer(type);
    if (answer === null || answer === '') {
      setFeedback('Please provide an answer.', 'err');
      return;
    }

    // Optional correctness check if correctAnswer provided (simple match)
    let isCorrect = true;
    if (typeof pendingRequest.correctAnswer !== 'undefined') {
      const expected = pendingRequest.correctAnswer;
      if (type === 'numerical') {
        const tol = typeof pendingRequest.tolerance === 'number' ? pendingRequest.tolerance : 0;
        isCorrect = Math.abs(Number(answer) - Number(expected)) <= tol;
      } else {
        isCorrect = String(answer).toLowerCase().trim() === String(expected).toLowerCase().trim();
      }
    }

    // Send response back to background if a requestId is included.
    if (pendingRequest.requestId) {
      chrome.runtime.sendMessage({
        action: 'overlay_answer',
        requestId: pendingRequest.requestId,
        payload: {
          answer,
          type,
          correct: isCorrect
        }
      });
    }

    setFeedback(isCorrect ? 'Answer recorded. You may continue.' : 'Answer recorded. It seems incorrect.', isCorrect ? 'ok' : 'info');
    continueBtn.disabled = false;
  });

  continueBtn.addEventListener('click', () => {
    hideOverlay();
  });

  // Listen for messages to show overlay with a specific question
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'show_overlay') {
      // Basic default prompt if none is provided
      const payload = request.payload || {
        question: 'What is 2 + 2?',
        type: 'numerical',
        correctAnswer: 4,
        requestId: 'default'
      };
      renderQuestion(payload);
      sendResponse?.({ status: 'overlay shown' });
      return true;
    }
    if (request.action === 'ask_question') {
      // Strict: requires payload
      if (request.payload) {
        renderQuestion(request.payload);
        sendResponse?.({ status: 'question rendered' });
      } else {
        sendResponse?.({ status: 'no payload' });
      }
      return true;
    }
  });
})();