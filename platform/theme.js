// Applies the saved light or dark choice before the page paints. Runs as a plain script so there is no flash.
try{const t=localStorage.getItem('mediahub-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch{}
