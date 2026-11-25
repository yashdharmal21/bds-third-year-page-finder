(() => {
  const TEST = window.OP_TEST_QUESTIONS || [];
  const ATTEMPT_KEY = 'bds-page-finder-op-test-v1';
  const DISMISSED_KEY = 'bds-page-finder-op-test-dismissed';
  const TOTAL_MS = 50 * 60 * 1000;
  const DEV_MODE = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('testDev');
  const SUBMISSION_URL = window.OP_TEST_SUBMISSION_URL || '';
  const overlay = document.getElementById('test-overlay');
  if (!overlay || TEST.length !== 50) return;

  const byId = (id) => document.getElementById(id);
  const intro = byId('test-intro');
  const quiz = byId('test-quiz');
  const finished = byId('test-finished');
  const nameInput = byId('test-name');
  const startButton = byId('test-start');
  const options = byId('test-options');
  let attempt = readAttempt();
  let timerInterval = null;

  function readAttempt() {
    try { return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || 'null'); }
    catch { return null; }
  }
  function saveAttempt() { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt)); }
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  function setView(which) {
    intro.hidden = which !== 'intro';
    quiz.hidden = which !== 'quiz';
    finished.hidden = which !== 'finished';
  }
  function show() {
    overlay.hidden = false;
    document.body.classList.add('test-open');
  }
  function hide() {
    overlay.hidden = true;
    document.body.classList.remove('test-open');
  }
  function formatTime(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function makeAttemptId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function renderQuestion() {
    if (!attempt || attempt.status !== 'in_progress') return;
    if (Date.now() >= attempt.deadline) return finish(true);
    const question = attempt.questions[attempt.index];
    byId('test-progress').textContent = `Question ${attempt.index + 1} of ${attempt.questions.length}`;
    byId('test-progress-bar').style.width = `${(attempt.index / attempt.questions.length) * 100}%`;
    byId('test-subject').textContent = question.topic;
    byId('test-question').textContent = question.question;
    byId('test-timer').textContent = formatTime(attempt.deadline - Date.now());
    options.replaceChildren();
    question.options.forEach((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'test-option';
      const letter = document.createElement('span');
      letter.className = 'test-option-letter';
      letter.textContent = String.fromCharCode(65 + index);
      const text = document.createElement('span');
      text.textContent = label;
      button.append(letter, text);
      button.addEventListener('click', () => answer(index));
      options.appendChild(button);
    });
  }

  function answer(optionIndex) {
    if (!attempt || attempt.status !== 'in_progress' || attempt.answers[attempt.index] !== null) return;
    if (Date.now() >= attempt.deadline) return finish(true);
    const question = attempt.questions[attempt.index];
    attempt.answers[attempt.index] = { id: question.id, choice: question.choiceIds[optionIndex] };
    attempt.index += 1;
    saveAttempt();
    if (attempt.index >= attempt.questions.length) finish(false);
    else renderQuestion();
  }

  function finish(timedOut) {
    if (!attempt || attempt.status !== 'in_progress') return;
    clearInterval(timerInterval);
    attempt.status = 'submitted';
    attempt.submittedAt = Date.now();
    attempt.timedOut = Boolean(timedOut);
    attempt.deliveryQueued = false;
    saveAttempt();
    setView('finished');
    byId('test-finished-title').textContent = timedOut ? 'Time is up — test submitted' : 'Test submitted';
    byId('test-result-summary').textContent = '';
    byId('test-finished-copy').textContent = SUBMISSION_URL
      ? 'Sending your answers for marking. Only your name and final score will be saved.'
      : 'Local preview only: this attempt stays in this browser and is not sent to the app owner.';
    byId('test-close').hidden = false;
    if (SUBMISSION_URL) sendSubmission();
  }

  async function sendSubmission() {
    if (!attempt || !SUBMISSION_URL || attempt.deliveryQueued) return;
    const answers = attempt.questions.map((question, index) => attempt.answers[index] || { id: question.id, choice: -1 });
    const body = new URLSearchParams({ payload: JSON.stringify({ name: attempt.name, attemptId: attempt.attemptId, answers }) });
    try {
      await fetch(SUBMISSION_URL, { method: 'POST', mode: 'no-cors', body });
      attempt.deliveryQueued = true;
      saveAttempt();
      byId('test-finished-copy').textContent = 'Submission sent. The organizer will see your name and score; your individual answers are not kept.';
    } catch (error) {
      byId('test-finished-copy').textContent = 'The submission could not be sent. Please contact the organizer so your score can be checked.';
    }
  }

  function begin() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setCustomValidity('Enter your name to start the test.');
      nameInput.reportValidity();
      return;
    }
    nameInput.setCustomValidity('');
    const questions = shuffle(TEST.map((item, index) => {
      const choices = item.options.map((text, originalIndex) => ({ text, choiceId: originalIndex }));
      shuffle(choices);
      return { id: index + 1, topic: item.topic, question: item.question, options: choices.map((choice) => choice.text), choiceIds: choices.map((choice) => choice.choiceId) };
    }));
    attempt = {
      name,
      attemptId: makeAttemptId(),
      startedAt: Date.now(),
      deadline: Date.now() + TOTAL_MS,
      questions,
      answers: Array(questions.length).fill(null),
      index: 0,
      status: 'in_progress',
      deliveryQueued: false
    };
    saveAttempt();
    sessionStorage.removeItem(DISMISSED_KEY);
    setView('quiz');
    renderQuestion();
    timerInterval = setInterval(renderQuestion, 1000);
  }

  function resume() {
    if (attempt.status === 'submitted') {
      setView('finished');
      show();
      byId('test-finished-title').textContent = 'Attempt already submitted';
      byId('test-finished-copy').textContent = attempt.deliveryQueued
        ? 'This browser has a completed attempt. A second attempt is not available.'
        : 'This browser has a completed attempt awaiting delivery. Retrying submission now.';
      byId('test-result-summary').textContent = '';
      if (SUBMISSION_URL && !attempt.deliveryQueued) sendSubmission();
      return;
    }
    setView('quiz');
    show();
    renderQuestion();
    timerInterval = setInterval(renderQuestion, 1000);
  }

  startButton.addEventListener('click', begin);
  nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
  byId('test-later').addEventListener('click', () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    hide();
  });
  byId('test-close').addEventListener('click', hide);
  byId('test-clear-local').addEventListener('click', () => {
    localStorage.removeItem(ATTEMPT_KEY);
    sessionStorage.removeItem(DISMISSED_KEY);
    location.reload();
  });

  if (DEV_MODE) byId('test-clear-local').hidden = false;
  if (attempt && attempt.status) resume();
  else if (!sessionStorage.getItem(DISMISSED_KEY)) {
    setView('intro');
    show();
    window.setTimeout(() => nameInput.focus({ preventScroll: true }), 80);
  }
})();
