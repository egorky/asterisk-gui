try { document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark'; } catch (e) { /* tema por defecto */ }
