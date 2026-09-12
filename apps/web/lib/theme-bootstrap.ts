export const themeStorageKey = "amafh-core-theme";

// Static application-owned script: no request data, credentials or record content.
// Runs before paint; only the html theme attribute differs from server markup.
export const themeBootstrapScript = `(function(){var t;try{t=localStorage.getItem("${themeStorageKey}")}catch(e){}document.documentElement.dataset.theme=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"})()`;
