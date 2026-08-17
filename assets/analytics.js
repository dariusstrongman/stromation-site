(function () {
  "use strict";
  var verify = /[?&]stro_verify=1/.test(location.search);
  if (navigator.webdriver && !verify) return;
  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=G-0VDWHMS6MW";
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", "G-0VDWHMS6MW", verify ? { traffic_type: "internal" } : {});
})();
