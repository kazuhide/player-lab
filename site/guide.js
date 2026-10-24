(() => {
  "use strict";

  const normalize = (value) => value.normalize("NFKC").toLowerCase().trim();

  function setupSearch(container) {
    const input = container.querySelector("[data-guide-search]");
    const status = container.querySelector("[data-search-status]");
    const results = container.querySelector("[data-search-results]");
    if (!input || !status || !results) return;

    let indexURL;
    let directory;
    try {
      indexURL = new URL(container.dataset.searchIndex, document.baseURI);
      directory = new URL(".", indexURL);
      const language = document.documentElement.lang.split("-")[0];
      const languageSuffix = language === "ja" ? "/ja/guide/" : language === "en" ? "/guide/" : null;
      if (indexURL.origin !== location.origin || indexURL.username || indexURL.password ||
          indexURL.search || indexURL.hash || !indexURL.pathname.endsWith("/search-index.json") ||
          !languageSuffix || !directory.pathname.endsWith(languageSuffix) ||
          (language === "en" && directory.pathname.endsWith("/ja/guide/")) ||
          !location.pathname.startsWith(directory.pathname)) return;
    } catch {
      return;
    }

    function resultURL(value) {
      try {
        const url = new URL(value, indexURL);
        const decoded = new URL(decodeURIComponent(url.pathname), indexURL);
        if (url.origin !== indexURL.origin || url.username || url.password || url.search ||
            !url.pathname.startsWith(directory.pathname) ||
            !decoded.pathname.startsWith(directory.pathname) ||
            !(url.pathname.endsWith(".html") || url.pathname.endsWith("/"))) return null;
        return url.href;
      } catch {
        return null;
      }
    }

    let indexPromise;
    function loadIndex() {
      if (!indexPromise) {
        const pending = fetch(indexURL.href, { credentials: "same-origin", redirect: "error" })
          .then((response) => {
            if (!response.ok) throw new Error("Search index unavailable");
            return response.json();
          })
          .then((data) => {
            if (!Array.isArray(data)) throw new Error("Invalid search index");
            return data.flatMap((entry) => {
              if (!entry || typeof entry.title !== "string" || typeof entry.url !== "string") return [];
              const href = resultURL(entry.url);
              if (!href) return [];
              const excerpt = typeof entry.excerpt === "string" ? entry.excerpt : "";
              const text = typeof entry.text === "string" ? entry.text : "";
              return [{ title: entry.title, href, excerpt,
                titleText: normalize(entry.title), text: normalize(`${entry.title} ${excerpt} ${text}`) }];
            });
          })
          .catch((error) => {
            if (indexPromise === pending) indexPromise = undefined;
            throw error;
          });
        indexPromise = pending;
      }
      return indexPromise;
    }

    let generation = 0;
    async function search() {
      const owner = ++generation;
      const query = normalize(input.value);
      results.replaceChildren();
      results.hidden = true;
      status.textContent = "";
      container.removeAttribute("aria-busy");
      if (Array.from(query).length < 2) return;
      container.setAttribute("aria-busy", "true");
      status.textContent = container.dataset.msgLoading;
      try {
        const entries = await loadIndex();
        // Only the input that started this search may publish its result.
        if (owner !== generation) return;
        const terms = query.split(/\s+/);
        const matches = entries.filter((entry) => terms.every((term) => entry.text.includes(term)));
        const score = (entry) => (entry.titleText === query ? 100 : 0) +
          (entry.titleText.startsWith(query) ? 30 : 0) +
          terms.filter((term) => entry.titleText.includes(term)).length;
        matches.sort((a, b) => score(b) - score(a));
        for (const entry of matches.slice(0, 12)) {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.href = entry.href;
          link.textContent = entry.title;
          item.appendChild(link);
          if (entry.excerpt) {
            const excerpt = document.createElement("p");
            excerpt.textContent = entry.excerpt;
            item.appendChild(excerpt);
          }
          results.appendChild(item);
        }
        const count = Math.min(matches.length, 12);
        results.hidden = count === 0;
        status.textContent = count ? container.dataset.msgCount.replace("{count}", String(count)) : container.dataset.msgEmpty;
      } catch {
        if (owner !== generation) return;
        status.textContent = container.dataset.msgError;
      } finally {
        if (owner === generation) container.removeAttribute("aria-busy");
      }
    }
    container.hidden = false;
    input.addEventListener("input", () => { void search(); });
  }

  function setupCurrentSections() {
    const sections = new Map();
    const documentPath = (pathname) => pathname.replace(/\/index\.html$/, "/");
    const isCurrentDocument = (link) => {
      const url = new URL(link.href, document.baseURI);
      return url.origin === location.origin && documentPath(url.pathname) === documentPath(location.pathname);
    };
    for (const link of document.querySelectorAll(".guide-nav a[data-guide-fragment]")) {
      if (!isCurrentDocument(link)) continue;
      const id = link.dataset.guideFragment;
      const target = document.getElementById(id);
      if (!target) continue;
      if (!sections.has(id)) sections.set(id, { target, links: [] });
      sections.get(id).links.push(link);
    }
    if (!sections.size) return () => {};

    const ordered = Array.from(sections.entries()).sort(([, a], [, b]) =>
      a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const pageLinks = Array.from(document.querySelectorAll(".guide-nav a[data-guide-page-current]"))
      .filter(isCurrentDocument);
    const guidePage = document.querySelector(".guide-page") || document.documentElement;
    let selected;
    let pending = false;
    function update() {
      pending = false;
      const offset = parseFloat(getComputedStyle(guidePage).getPropertyValue("--guide-header-offset")) || 0;
      let current = null;
      for (const [id, section] of ordered) {
        if (section.target.getBoundingClientRect().top <= offset + 24) current = id;
      }
      if (current === selected) return;
      if (selected) {
        for (const link of sections.get(selected).links) link.removeAttribute("aria-current");
      }
      for (const link of pageLinks) {
        if (current) link.removeAttribute("aria-current");
        else link.setAttribute("aria-current", "page");
      }
      if (current) {
        for (const link of sections.get(current).links) link.setAttribute("aria-current", "location");
      }
      selected = current;
    }
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("hashchange", schedule);
    window.addEventListener("load", schedule, { once: true });
    schedule();
    return schedule;
  }

  function initialize() {
    for (const container of document.querySelectorAll("[data-guide-search-container]")) setupSearch(container);
    const languageLinks = document.querySelectorAll("a[data-guide-language]");
    function preserveHash() {
      for (const link of languageLinks) {
        const url = new URL(link.href);
        if (url.origin === location.origin) {
          url.hash = location.hash;
          link.href = url.href;
        }
      }
    }
    preserveHash();
    window.addEventListener("hashchange", preserveHash);
    for (const link of languageLinks) link.addEventListener("click", preserveHash);
    const scheduleCurrentSections = setupCurrentSections();
    const header = document.querySelector(".guide-header");
    if (header) {
      const guidePage = document.querySelector(".guide-page") || document.documentElement;
      const measure = () => {
        guidePage.style.setProperty("--guide-header-offset", `${Math.ceil(header.getBoundingClientRect().height) + 16}px`);
        scheduleCurrentSections();
      };
      measure();
      if ("ResizeObserver" in window) new ResizeObserver(measure).observe(header);
      else window.addEventListener("resize", measure, { passive: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
