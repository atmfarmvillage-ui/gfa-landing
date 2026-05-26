// Edge Function : watermark-pdf
// Reçoit ?t=<token>, valide via acces_virtuels, télécharge le PDF depuis Storage,
// appose un watermark dynamique (nom + tel acheteur) sur chaque page, renvoie le PDF.
//
// Deploy : supabase functions deploy watermark-pdf
// Secrets requis (auto sur Supabase Edge) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { PDFDocument, StandardFonts, degrees, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const SUPA_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function errPage(msg: string, code = 400) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Erreur</title>
<style>body{font-family:system-ui,sans-serif;background:#F8FAFC;color:#0F172A;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}
.b{background:white;border-radius:14px;padding:36px;max-width:420px;box-shadow:0 14px 40px rgba(15,43,107,.10);border:1px solid #E2E8F0}
h1{color:#dc2626;margin:0 0 10px;font-size:22px}p{color:#475569;line-height:1.6;margin:0 0 20px}
a{background:#1B4FD8;color:white;padding:10px 22px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px}</style>
</head><body><div class="b"><h1>⚠️ ${msg}</h1><p>Si ce lien provient d'un message ATM, contactez-nous directement.</p>
<a href="https://wa.me/22870992018">💬 Contacter ATM</a></div></body></html>`
  return new Response(html, { status: code, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('t') || ''
    if (!token) return errPage('Lien invalide', 400)

    const sb = createClient(SUPA_URL, SERVICE_KEY)

    // 1. Valider le token
    const { data: acces, error: e1 } = await sb.from('acces_virtuels')
      .select('lien_reel, expire_le, commande_id, nb_clics')
      .eq('token', token).maybeSingle()
    if (e1 || !acces) return errPage('Accès introuvable', 404)

    if (acces.expire_le && new Date(acces.expire_le as string) < new Date()) {
      return errPage('Lien expiré', 410)
    }

    if (!acces.lien_reel || typeof acces.lien_reel !== 'string' || !acces.lien_reel.startsWith('storage:')) {
      return errPage('Format de contenu invalide', 400)
    }

    const m = acces.lien_reel.match(/^storage:([^/]+)\/(.+)$/)
    if (!m) return errPage('Chemin storage invalide', 400)
    const [, bucket, path] = m

    // 2. Récupérer info acheteur (pour watermark)
    let clientNom = '', clientTel = ''
    if (acces.commande_id) {
      const { data: cmd } = await sb.from('commandes')
        .select('client_nom,client_tel')
        .eq('id', acces.commande_id as string).maybeSingle()
      if (cmd) {
        clientNom = (cmd.client_nom as string) || ''
        clientTel = (cmd.client_tel as string) || ''
      }
    }

    // 3. Télécharger le PDF d'origine
    const { data: blob, error: e2 } = await sb.storage.from(bucket).download(path)
    if (e2 || !blob) return errPage('PDF introuvable', 404)

    const bytes = new Uint8Array(await blob.arrayBuffer())
    let pdf
    try {
      pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
    } catch (e) {
      console.error('PDF load failed:', e)
      return errPage('PDF illisible (corrompu ou chiffré)', 500)
    }

    const font = await pdf.embedFont(StandardFonts.HelveticaBold)

    const acheteur = [clientNom, clientTel].filter(Boolean).join(' · ') || 'Acheteur ATM'
    const footer = `ATM Farm Village · Diffusion privée · ${acheteur}`
    const dateStr = new Date().toISOString().slice(0, 10)

    // 4. Watermark sur chaque page
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize()

      // Watermark diagonal central (gros, transparent)
      const acheteurWidth = font.widthOfTextAtSize(acheteur, 42)
      page.drawText(acheteur, {
        x: width / 2 - acheteurWidth / 2 * 0.7,
        y: height / 2 - 20,
        size: 42,
        font,
        color: rgb(0.55, 0.55, 0.55),
        opacity: 0.14,
        rotate: degrees(-30),
      })

      // Footer discret en bas
      page.drawText(footer, {
        x: 30,
        y: 18,
        size: 8,
        font,
        color: rgb(0.25, 0.25, 0.25),
        opacity: 0.65,
      })

      // Date d'accès en haut à droite (preuve)
      const dateText = `Téléchargé le ${dateStr}`
      const dateWidth = font.widthOfTextAtSize(dateText, 7)
      page.drawText(dateText, {
        x: width - dateWidth - 20,
        y: height - 18,
        size: 7,
        font,
        color: rgb(0.4, 0.4, 0.4),
        opacity: 0.55,
      })
    }

    const out = await pdf.save()

    // 5. Compteur (best-effort)
    sb.from('acces_virtuels').update({
      nb_clics: ((acces.nb_clics as number) || 0) + 1,
      dernier_clic: new Date().toISOString(),
    }).eq('token', token).then(() => {})

    const filename = (path.split('/').pop() || 'document').replace(/\.pdf$/i, '') + '_ATM.pdf'

    return new Response(out, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (err) {
    console.error('watermark-pdf error:', err)
    return errPage('Erreur serveur', 500)
  }
})
