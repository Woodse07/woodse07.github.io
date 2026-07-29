/*
 * Counts the pageview, then removes the campaign query string from the address
 * bar so visitors see a clean URL.
 *
 * The ordering matters and is easy to get wrong. count.js sends the query
 * string as its own field, read from location.search at the moment it counts:
 *
 *     q: location.search
 *
 * Strip the URL before that runs and the campaign is silently lost — the
 * utm_campaign links stop reporting anything, with no error to notice.
 *
 * So the script is loaded with no_onload, which hands us the moment of
 * counting. The catch is that count.js's onload block does two things, and
 * no_onload disables both:
 *
 *     if (!goatcounter.no_onload)
 *       on_load(function() {
 *         goatcounter.count()
 *         if (!goatcounter.no_events)
 *           goatcounter.bind_events()   <- powers data-goatcounter-click
 *       })
 *
 * bind_events is what makes the outbound link tracking work, so it has to be
 * called here too. The visibility handling below mirrors count.js's own, so a
 * page opened in a background tab is still counted when it is first looked at
 * rather than being dropped by the visibility filter.
 */

(function () {
  var tag = document.querySelector("script[data-goatcounter]");
  if (!tag) return;

  var stripQueryString = function () {
    if (!location.search) return;
    if (!window.history || !window.history.replaceState) return;
    window.history.replaceState(null, "", location.pathname + location.hash);
  };

  var countThenStrip = function () {
    var gc = window.goatcounter;
    if (!gc || typeof gc.count !== "function") return;

    gc.count();
    if (!gc.no_events && typeof gc.bind_events === "function") gc.bind_events();
    stripQueryString();
  };

  var start = function () {
    if (!("visibilityState" in document) || document.visibilityState === "visible") {
      countThenStrip();
      return;
    }
    // Not visible yet (background tab, prerender). Wait, as count.js would.
    var onVisible = function () {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      countThenStrip();
    };
    document.addEventListener("visibilitychange", onVisible);
  };

  if (window.goatcounter && typeof window.goatcounter.count === "function") {
    start(); // async script already finished before this ran
  } else {
    tag.addEventListener("load", start);
    // If count.js is blocked there is nothing to count, but the URL should
    // still be tidied rather than left showing the campaign tag.
    tag.addEventListener("error", stripQueryString);
  }
})();
