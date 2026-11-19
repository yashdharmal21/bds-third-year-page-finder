(() => {
  const subjects = window.STUDY_DATA || {};
  const subjectNames = {
    oral: 'Oral Pathology',
    medicine: 'General Medicine',
    surgery: 'General Surgery',
  };
  const subjectStartPages = { oral: 493, medicine: 3, surgery: 261 };
  const BOOK_TO_PDF_OFFSET = 4;
  const el = (id) => document.getElementById(id);
  const subjectSelect = el('subject-select');
  const searchInput = el('search-input');
  const chapterSelect = el('chapter-select');
  const list = el('question-list');
  const emptyState = el('empty-state');
  const resultCount = el('result-count');
  const fileInput = el('book-file');
  const bookStatus = el('book-status');
  const bookEmpty = el('book-empty');
  const viewerWrap = el('viewer-wrap');
  const pdfFrame = el('pdf-frame');
  const pdfCanvasWrap = el('pdf-canvas-wrap');
  let pdfCanvas = el('pdf-canvas');
  const pageLabel = el('viewer-page-label');
  const openTabButton = el('open-tab');
  const selectionHint = el('selection-hint');
  const topicCount = el('topic-count');
  const chapterCount = el('chapter-count');
  const chapterUnit = el('chapter-unit');
  const footerSource = document.querySelector('.footer em');
  let activeSubject = subjectSelect.value || 'oral';
  let chapters = [];
  let questions = [];
  let currentMatches = [];
  let bookUrl = '';
  let bookFile = null;
  let pdfDocument = null;
  let pdfLoadingPromise = null;
  let pdfLibraryPromise = null;
  let renderTask = null;
  let renderQueue = Promise.resolve();
  let lastRenderedSignature = '';
  let resizeTimer = null;
  let pdfGeneration = 0;
  const useCanvasPdfViewer = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || new URLSearchParams(location.search).has('renderPdfInCanvas');
  let currentPdfPage = 0;
  let selectedKey = '';

  function setSubject(subjectId) {
    activeSubject = subjects[subjectId] ? subjectId : 'oral';
    chapters = subjects[activeSubject] || [];
    questions = chapters.flatMap((chapter, chapterIndex) => chapter.items.map((item, itemIndex) => ({
      ...item,
      chapterTitle: chapter.title,
      chapterIndex,
      itemIndex,
      key: `${activeSubject}-${chapterIndex}-${itemIndex}`,
    })));

    chapterSelect.replaceChildren(new Option('All chapters', 'all'));
    chapters.forEach((chapter, index) => chapterSelect.add(new Option(chapter.title.replace(/^Chapter \d+\s*[-–]\s*/, ''), String(index))));
    topicCount.textContent = String(questions.length);
    chapterCount.textContent = String(chapters.length);
    chapterUnit.textContent = activeSubject === 'surgery' ? 'groups' : 'chapters';
    subjectSelect.value = activeSubject;
    selectedKey = '';
    searchInput.value = '';
    chapterSelect.value = 'all';
    list.scrollTop = 0;
    if (footerSource) footerSource.textContent = 'Mastering the BDS IIIrd Year · ' + subjectNames[activeSubject];
    selectionHint.textContent = `Choose a ${subjectNames[activeSubject]} topic to see its book page.`;
    if (bookUrl) jumpToPage(subjectStartPages[activeSubject] + BOOK_TO_PDF_OFFSET, `${subjectNames[activeSubject]} section start`);
    render();
  }

  function parsePageOptions(value) {
    if (/not located/i.test(value)) return [];
    const options = [];
    for (const chunk of value.split(';')) {
      const match = chunk.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) continue;
      const firstBookPage = Number(match[1]);
      const lastBookPage = match[2] ? Number(match[2]) : firstBookPage;
      options.push({
        label: firstBookPage === lastBookPage ? `Book p. ${firstBookPage}` : `Book pp. ${firstBookPage}-${lastBookPage}`,
        bookPage: firstBookPage,
        pdfPage: firstBookPage + BOOK_TO_PDF_OFFSET,
      });
    }
    return options;
  }

  function visibleItems() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const chapter = chapterSelect.value;
    const stopWords = new Set(['a', 'an', 'and', 'are', 'describe', 'define', 'discuss', 'do', 'for', 'give', 'in', 'list', 'of', 'on', 'or', 'the', 'to', 'what', 'which', 'with', 'write']);
    const terms = query.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1 && !stopWords.has(term));
    return questions.map((item) => {
      const inChapter = chapter === 'all' || item.chapterIndex === Number(chapter);
      const searchable = `${item.question} ${item.chapterTitle} ${item.pages} ${item.note}`.toLocaleLowerCase();
      const score = terms.length ? terms.filter((term) => searchable.includes(term)).length / terms.length : 1;
      return { item, inChapter, score, matches: !query || searchable.includes(query) || score >= 0.5 };
    }).filter((entry) => entry.inChapter && entry.matches)
      .sort((a, b) => query ? b.score - a.score || a.item.chapterIndex - b.item.chapterIndex || a.item.itemIndex - b.item.itemIndex : a.item.chapterIndex - b.item.chapterIndex || a.item.itemIndex - b.item.itemIndex)
      .map((entry) => entry.item);
  }

  function jumpToPage(pdfPage, label) {
    currentPdfPage = pdfPage;
    pageLabel.textContent = `${label} · PDF page ${pdfPage}`;
    if (!bookUrl) {
      bookStatus.textContent = 'Choose the full book PDF to open this page';
      selectionHint.textContent = 'Choose “Mastering 3rd year.pdf” above to jump to the selected topic.';
      bookEmpty.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (useCanvasPdfViewer) {
      renderCanvasPage(pdfPage);
    } else {
      pdfFrame.src = `${bookUrl}#page=${pdfPage}&zoom=page-fit`;
    }
    selectionHint.textContent = `Showing PDF page ${pdfPage} for ${label}.`;
  }

  function loadPdfLibrary() {
    if (!pdfLibraryPromise) {
      pdfLibraryPromise = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
        return pdfjsLib;
      });
    }
    return pdfLibraryPromise;
  }

  function renderCanvasPage(pageNumber) {
    const generation = pdfGeneration;
    pageLabel.textContent = `${pageLabel.textContent.split(' · ')[0]} · Loading PDF page ${pageNumber}…`;
    renderQueue = renderQueue.catch(() => {}).then(() => renderCanvasPageNow(pageNumber, generation));
    return renderQueue;
  }

  async function renderCanvasPageNow(pageNumber, generation) {
    try {
      const pdfjsLib = await loadPdfLibrary();
      if (generation !== pdfGeneration || pageNumber !== currentPdfPage) return;
      if (!pdfLoadingPromise) {
        pdfLoadingPromise = bookFile.arrayBuffer().then((data) => pdfjsLib.getDocument({ data }).promise);
      }
      pdfDocument = await pdfLoadingPromise;
      if (generation !== pdfGeneration || pageNumber !== currentPdfPage) return;
      if (pageNumber < 1 || pageNumber > pdfDocument.numPages) {
        throw new Error(`This PDF has ${pdfDocument.numPages} pages; page ${pageNumber} is outside it.`);
      }
      if (renderTask) {
        const previousTask = renderTask;
        previousTask.cancel();
        try { await previousTask.promise; } catch (error) {
          if (!error || error.name !== 'RenderingCancelledException') throw error;
        }
        renderTask = null;
      }
      if (generation !== pdfGeneration || pageNumber !== currentPdfPage) return;
      const page = await pdfDocument.getPage(pageNumber);
      if (generation !== pdfGeneration || pageNumber !== currentPdfPage) return;
      const availableWidth = Math.max(260, pdfCanvasWrap.clientWidth - 16);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const signature = `${pageNumber}:${availableWidth}:${pixelRatio}`;
      if (signature === lastRenderedSignature) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = availableWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const nextCanvas = document.createElement('canvas');
      nextCanvas.id = 'pdf-canvas';
      nextCanvas.setAttribute('aria-label', 'PDF page');
      pdfCanvas.replaceWith(nextCanvas);
      pdfCanvas = nextCanvas;
      const context = pdfCanvas.getContext('2d', { alpha: false });
      pdfCanvas.width = Math.ceil(viewport.width * pixelRatio);
      pdfCanvas.height = Math.ceil(viewport.height * pixelRatio);
      pdfCanvas.style.width = `${Math.ceil(viewport.width)}px`;
      pdfCanvas.style.height = `${Math.ceil(viewport.height)}px`;
      const task = page.render({ canvasContext: context, viewport, transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      renderTask = task;
      await task.promise;
      if (renderTask === task) renderTask = null;
      lastRenderedSignature = signature;
      pageLabel.textContent = pageLabel.textContent.replace(/ · Loading PDF page \d+…$/, '');
    } catch (error) {
      if (error && error.name === 'RenderingCancelledException') return;
      if (generation !== pdfGeneration || pageNumber !== currentPdfPage) return;
      console.error('Could not render the selected PDF page:', error);
      pageLabel.textContent = `Could not display PDF page ${pageNumber}`;
      selectionHint.textContent = `Try opening the PDF in a new tab, or select it again. ${error.message || ''}`;
    }
  }

  function render() {
    currentMatches = visibleItems();
    list.replaceChildren();
    resultCount.textContent = `${currentMatches.length} ${currentMatches.length === 1 ? 'question' : 'questions'}`;
    emptyState.hidden = currentMatches.length > 0;
    list.hidden = currentMatches.length === 0;

    let lastChapter = '';
    for (const item of currentMatches) {
      if (chapterSelect.value === 'all' && item.chapterTitle !== lastChapter) {
        const heading = document.createElement('div');
        heading.className = 'chapter-label';
        heading.textContent = item.chapterTitle;
        list.append(heading);
        lastChapter = item.chapterTitle;
      }

      const card = document.createElement('article');
      card.className = `question-card${selectedKey === item.key ? ' selected' : ''}`;
      card.setAttribute('role', 'listitem');
      const top = document.createElement('div');
      top.className = 'question-top';
      const title = document.createElement('h3');
      title.className = 'question-title';
      title.textContent = item.question;
      const pages = document.createElement('span');
      pages.className = 'pages-label';
      pages.textContent = item.pages;
      top.append(title, pages);
      card.append(top);

      if (item.note) {
        const note = document.createElement('p');
        note.className = 'question-note';
        note.textContent = item.note;
        card.append(note);
      }

      const options = parsePageOptions(item.pages);
      if (options.length) {
        const buttons = document.createElement('div');
        buttons.className = 'page-links';
        for (const option of options) {
          const button = document.createElement('button');
          button.className = 'page-link';
          button.type = 'button';
          button.textContent = option.label;
          button.setAttribute('aria-pressed', String(currentPdfPage === option.pdfPage));
          button.addEventListener('click', () => {
            selectedKey = item.key;
            jumpToPage(option.pdfPage, option.label);
            render();
          });
          buttons.append(button);
        }
        card.append(buttons);
      } else {
        card.classList.add('no-page-link');
      }
      list.append(card);
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    pdfGeneration += 1;
    if (renderTask) { renderTask.cancel(); renderTask = null; }
    if (pdfDocument) pdfDocument.destroy();
    pdfDocument = null;
    pdfLoadingPromise = null;
    lastRenderedSignature = '';
    if (bookUrl) URL.revokeObjectURL(bookUrl);
    bookUrl = URL.createObjectURL(file);
    bookFile = file;
    bookStatus.textContent = file.name;
    bookEmpty.hidden = true;
    viewerWrap.hidden = false;
    currentPdfPage = currentPdfPage || subjectStartPages[activeSubject] + BOOK_TO_PDF_OFFSET;
    if (useCanvasPdfViewer) {
      pdfFrame.hidden = true;
      pdfCanvasWrap.hidden = false;
      renderCanvasPage(currentPdfPage);
    } else {
      pdfCanvasWrap.hidden = true;
      pdfFrame.hidden = false;
      pdfFrame.src = `${bookUrl}#page=${currentPdfPage}&zoom=page-fit`;
    }
    pageLabel.textContent = `${subjectNames[activeSubject]} section start · PDF page ${currentPdfPage}`;
    selectionHint.textContent = `Full book loaded at the ${subjectNames[activeSubject]} section. Choose any page button to jump to a topic.`;
  });

  openTabButton.addEventListener('click', () => {
    if (!bookUrl) return fileInput.click();
    window.open(`${bookUrl}#page=${currentPdfPage || 1}&zoom=page-fit`, '_blank', 'noopener');
  });
  subjectSelect.addEventListener('change', () => setSubject(subjectSelect.value));
  window.addEventListener('resize', () => {
    if (!useCanvasPdfViewer || !bookUrl) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      lastRenderedSignature = '';
      renderCanvasPage(currentPdfPage);
    }, 180);
  });
  searchInput.addEventListener('input', render);
  chapterSelect.addEventListener('change', render);
  el('clear-filters').addEventListener('click', () => {
    searchInput.value = '';
    chapterSelect.value = 'all';
    selectedKey = '';
    render();
    searchInput.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      render();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (bookUrl) URL.revokeObjectURL(bookUrl);
    if (pdfDocument) pdfDocument.destroy();
  });
  setSubject(activeSubject);
})();
