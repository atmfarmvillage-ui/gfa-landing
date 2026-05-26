// Cloudflare Pages Function : /produit?slug=...
// Pré-remplit les balises Open Graph côté serveur (avant que la page n'arrive au scraper
// WhatsApp/Facebook/iMessage) pour que la preview du lien partagé affiche la miniature
// et le titre de la formation au lieu du logo générique GFA.
//
// Le JS client de produit.html continue de fonctionner — il met juste à jour des balises
// qui sont déjà correctes côté serveur.

const SUPA_URL = 'https://ikdzmzlleemkegnpqgvu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrZHptemxsZWVta2VnbnBxZ3Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NjIxNDUsImV4cCI6MjA5MTIzODE0NX0.FYJrw4JfwFlbirITmX2f7Y_pixr7KdeMzRMNn_3k0d4';
const DEFAULT_IMG = 'https://app.avifarmer.net/icons/icon-512.png';
const SITE_NAME = 'ATM Farm Village';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const slug = url.searchParams.get('slug');

  // Sert le HTML statique (produit.html) comme baseline
  const original = await context.next();

  // Pas de slug → on renvoie tel quel (la page client gérera le message d'erreur)
  if (!slug) return original;

  // Fetch le produit depuis Supabase (lecture publique sur formations)
  let titre = 'Produit ATM Farm Village';
  let description = 'Découvrez ce produit.';
  let image = DEFAULT_IMG;

  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/formations?slug=eq.${encodeURIComponent(slug)}&select=titre,description,miniature,image_url,type&limit=1`,
      {
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          'Accept': 'application/json',
        },
        // 6s max pour ne jamais bloquer la page si Supabase rame
        cf: { cacheTtl: 60, cacheEverything: false },
      }
    );
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr[0]) {
        const p = arr[0];
        if (p.titre) titre = p.titre;
        if (p.description) description = String(p.description).slice(0, 300);
        const img = p.image_url || p.miniature;
        if (img && /^https?:\/\//i.test(img)) image = img;
      }
    }
  } catch (e) {
    // Fallback silencieux sur les valeurs par défaut
  }

  const canonicalUrl = `${url.origin}/produit?slug=${encodeURIComponent(slug)}`;
  const fullTitle = `${titre} — ${SITE_NAME}`;

  // Injection des nouvelles balises via HTMLRewriter
  const transformed = new HTMLRewriter()
    .on('title#pageTitle', {
      element(el) { el.setInnerContent(fullTitle); }
    })
    .on('meta#metaDesc', {
      element(el) { el.setAttribute('content', description); }
    })
    .on('meta#ogTitle', {
      element(el) { el.setAttribute('content', fullTitle); }
    })
    .on('meta#ogDesc', {
      element(el) { el.setAttribute('content', description); }
    })
    .on('meta#ogImage', {
      element(el) { el.setAttribute('content', image); }
    })
    .on('head', {
      element(el) {
        const extra = `
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="fr_FR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(fullTitle)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`;
        el.append(extra, { html: true });
      }
    })
    .transform(original);

  // Headers : on garde Content-Type HTML et on ajoute un cache court pour aider
  // les scrapers à voir des données fraîches sans pénaliser les utilisateurs.
  const headers = new Headers(transformed.headers);
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  headers.set('X-OG-Slug', slug);

  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
