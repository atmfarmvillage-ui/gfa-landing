// ═══════════════════════════════════════════════════════════
// Boutique GFA — utilitaires partagés (vitrine + produit + checkout)
// ═══════════════════════════════════════════════════════════

const SHOP_SUPA_URL = 'https://ikdzmzlleemkegnpqgvu.supabase.co';
const SHOP_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrZHptemxsZWVta2VnbnBxZ3Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NjIxNDUsImV4cCI6MjA5MTIzODE0NX0.FYJrw4JfwFlbirITmX2f7Y_pixr7KdeMzRMNn_3k0d4';
const SHOP_SB = (typeof supabase !== 'undefined') ? supabase.createClient(SHOP_SUPA_URL, SHOP_SUPA_KEY) : null;

const ATM_WHATSAPP = '+22870992018';
const ATM_WHATSAPP_E164 = '22870992018';

const FEDAPAY_PUBLIC_KEY = 'pk_live_sl8rovKwBzuvqQc1LWRNLIPl';

// ── Slugification ──
function slugify(s){
  if(!s) return '';
  return s.toString()
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,80);
}

// ── Charge tous les produits actifs (virtuels + réels) depuis Supabase ──
async function chargerTousLesProduits(){
  const [formationsRes, marcheRes] = await Promise.all([
    SHOP_SB.from('formations').select('*').eq('actif', true).order('created_at', {ascending:false}),
    SHOP_SB.from('prix_marche').select('*').eq('vendable', true).order('produit'),
  ]);

  const virtuels = (formationsRes.data || []).map(f => ({
    id: f.id,
    table: 'formations',
    type: 'virtuel',
    titre: f.titre,
    description: f.description || '',
    prix: f.gratuit ? 0 : (f.prix || 0),
    gratuit: !!f.gratuit,
    sous_type: f.type, // 'video' | 'pdf'
    categorie: f.categorie || '',
    image_url: f.image_url || f.miniature || '',
    lien_contenu: f.lien || '',
    slug: f.slug || slugify(f.titre),
  }));

  const reels = (marcheRes.data || []).map(p => ({
    id: p.id,
    table: 'prix_marche',
    type: 'reel',
    titre: p.produit,
    description: p.description || '',
    prix: p.prix_vente || 0,
    gratuit: false,
    unite: p.unite_vente || 'unité',
    categorie: p.categorie || '',
    image_url: p.image_url || '',
    slug: p.slug || slugify(p.produit),
  }));

  return [...virtuels, ...reels];
}

// ── Trouve un produit par slug (regarde dans les 2 tables) ──
async function trouverProduitParSlug(slug){
  if(!slug) return null;
  const tous = await chargerTousLesProduits();
  return tous.find(p => p.slug === slug) || null;
}

// ── Formate un prix en FCFA ──
function fcfa(n){
  if(!n || n <= 0) return 'Gratuit';
  return Number(n).toLocaleString('fr-FR') + ' FCFA';
}

// ── Génère un token aléatoire pour accès virtuel ──
function genererToken(longueur=20){
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for(let i=0; i<longueur; i++){
    token += chars[Math.floor(Math.random()*chars.length)];
  }
  return token;
}

// ── Construit le lien wa.me avec message pré-rempli ──
function lienWhatsApp(message){
  return `https://wa.me/${ATM_WHATSAPP_E164}?text=${encodeURIComponent(message)}`;
}
