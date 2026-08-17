(function () {
  "use strict";

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", function (event) {
      if (!event.target.closest("a")) return;
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var rising = document.querySelectorAll(".rise");
  if (reduced || !("IntersectionObserver" in window)) {
    rising.forEach(function (item) { item.classList.add("in"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6%", threshold: .06 });
    rising.forEach(function (item) { observer.observe(item); });
  }

  var intent = new URLSearchParams(window.location.search).get("intent");
  var intentField = document.querySelector("#intent");
  if (intentField && ["growth", "custom", "other"].indexOf(intent) >= 0) {
    intentField.value = intent;
  }

  var form = document.querySelector("#early-access-form");
  if (!form) return;
  var status = form.querySelector(".form-status");
  var loadedAt = Date.now();
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var button = form.querySelector("button[type=submit]");
    if (Date.now() - loadedAt < 2500) {
      status.textContent = "Please take a moment to review your request.";
      return;
    }
    button.disabled = true;
    status.textContent = "Sending your request...";
    try {
      var response = await fetch(form.action, {
        method: "POST",
        headers: { "Accept": "application/json" },
        body: new FormData(form)
      });
      var result = await response.json().catch(function () { return {}; });
      var succeeded = result.success === true || String(result.success).toLowerCase() === "true";
      if (!response.ok || !succeeded) throw new Error(result.message || "request failed");
      form.reset();
      status.textContent = "Request received. We will reply by email.";
      if (window.gtag) window.gtag("event", "early_access_submit");
    } catch (error) {
      if (/activation/i.test(String(error && error.message))) {
        status.innerHTML = "The form is awaiting one-time activation. Email <a href=\"mailto:sol@stromation.com\">sol@stromation.com</a> for now.";
      } else {
        status.innerHTML = "The form could not send. Email <a href=\"mailto:sol@stromation.com\">sol@stromation.com</a>.";
      }
    } finally {
      button.disabled = false;
    }
  });
})();
