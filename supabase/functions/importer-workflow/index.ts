import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const clean = (v: unknown, max = 2000): string | null =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

function strip(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}
function meta(html: string, wanted: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[0].matchAll(/([a-z-]+)\s*=\s*["']([^"']*)["']/gi)) attrs[a[1].toLowerCase()] = a[2];
    if ((attrs.property || attrs.name || "").toLowerCase() === wanted.toLowerCase()) return clean(attrs.content, 2000);
  }
  return null;
}
function productNodes(value: unknown, out: Record<string, unknown>[] = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const x of value) productNodes(x, out); return out; }
  const x = value as Record<string, unknown>;
  const types = Array.isArray(x["@type"]) ? x["@type"] : [x["@type"]];
  if (types.some(t => String(t).toLowerCase() === "product")) out.push(x);
  for (const k of ["@graph", "mainEntity", "itemListElement"]) if (x[k]) productNodes(x[k], out);
  return out;
}
function images(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(images);
  if (v && typeof v === "object") { const x = v as Record<string, unknown>; return images(x.url ?? x.contentUrl ?? x["@id"]); }
  return [];
}
function private4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
function private6(ip: string) {
  const x = ip.toLowerCase().split("%")[0];
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") ||
    /^fe[89ab]/.test(x) || x.startsWith("::ffff:") || x.startsWith("ff");
}
async function checkedUrl(raw: string) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new Error("Only public HTTP(S) URLs without credentials are allowed.");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("Non-standard ports are blocked.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || /\.(local|localhost|internal)$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) throw new Error("Local, internal, and literal-IP URLs are blocked.");
  const ips: string[] = [];
  try { ips.push(...await Deno.resolveDns(host, "A")); } catch {}
  try { ips.push(...await Deno.resolveDns(host, "AAAA")); } catch {}
  if (!ips.length || ips.some(ip => ip.includes(":") ? private6(ip) : private4(ip))) throw new Error("The hostname could not be verified as a public address.");
  u.hash = "";
  return u;
}
async function fetchHtml(raw: string) {
  let current = raw;
  for (let i = 0; i <= 3; i++) {
    const u = await checkedUrl(current);
    const r = await fetch(u.toString(), {
      redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "PuffbuddyProductResearch/0.1 (staff-submitted URLs)", "Accept": "text/html,application/xhtml+xml" },
    });
    if ([301,302,303,307,308].includes(r.status)) {
      const loc = r.headers.get("location");
      if (!loc || i === 3) throw new Error("Too many redirects.");
      current = new URL(loc, u).toString(); continue;
    }
    if (!r.ok) throw new Error("Source returned HTTP " + r.status + ".");
    const type = r.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("URL is not an HTML product page.");
    if (Number(r.headers.get("content-length") || 0) > 1_000_000) throw new Error("Page exceeds the 1 MB limit.");
    const reader = r.body?.getReader(); if (!reader) throw new Error("Empty source response.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 1_000_000) { await reader.cancel(); throw new Error("Page exceeds the 1 MB limit."); }
      chunks.push(value);
    }
    const all = new Uint8Array(size); let pos = 0;
    for (const c of chunks) { all.set(c,pos); pos += c.length; }
    return { url: u.toString(), html: new TextDecoder().decode(all), status: r.status, type };
  }
  throw new Error("Unable to fetch source.");
}
async function robotsAllows(url: URL) {
  try {
    const ru = await checkedUrl(new URL("/robots.txt", url.origin).toString());
    const r = await fetch(ru.toString(), { redirect: "manual", signal: AbortSignal.timeout(3000), headers: { "User-Agent": "PuffbuddyProductResearch/0.1" } });
    if (r.status === 404 || r.status === 410) return true;
    if (!r.ok || r.status >= 300) return false;
    const txt = await r.text(); if (txt.length > 50000) return false;
    let star = false;
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.split("#")[0].trim(); const m = line.match(/^([^:]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase(), value = m[2].trim();
      if (key === "user-agent") star = value === "*";
      if (star && key === "disallow" && value && url.pathname.startsWith(value)) return false;
    }
    return true;
  } catch { return false; }
}
function parsePage(html: string, pageUrl: string) {
  const title = clean(strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""), 500);
  const h1 = clean(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || ""), 500);
  const description = meta(html,"og:description") || meta(html,"description");
  const cm = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  let canonical = pageUrl; try { if (cm?.[1]) canonical = new URL(cm[1],pageUrl).toString(); } catch {}
  const json: unknown[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { json.push(JSON.parse(m[1])); } catch {}
  }
  const nodes = json.flatMap(x => productNodes(x));
  const imageSet = new Set<string>();
  const og = meta(html,"og:image"); if (og) try { imageSet.add(new URL(og,pageUrl).toString()); } catch {}
  for (const n of nodes) for (const v of images(n.image)) try { imageSet.add(new URL(v,pageUrl).toString()); } catch {}
  for (const m of html.matchAll(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/gi)) {
    try { imageSet.add(new URL(m[1],pageUrl).toString()); } catch {}
    if (imageSet.size >= 10) break;
  }
  return { title,h1,description,canonical,nodes: nodes.length ? nodes : [null],images:[...imageSet].slice(0,10),text:clean(strip(html),16000) || "" };
}
function identity(brand: string | null, name: string, sku: string | null) {
  const n = (s:string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  return sku ? "sku:" + n(sku) : [n(brand || ""),n(name)].filter(Boolean).join("|");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  if (req.method !== "POST") return reply(405,{error:"POST required."});
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return reply(401,{error:"Sign in first."});
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!anon || !secret) throw new Error("Function environment is missing required Supabase keys.");
    const userClient = createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:auth}}});
    const {data:userResult,error:userError} = await userClient.auth.getUser();
    const user = userResult.user;
    if (userError || !user?.email) return reply(401,{error:"Could not verify your sign-in."});
    const adminClient = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const db = adminClient.schema("importer");
    const {data:allowed,error:allowError} = await db.from("importer_admin_users").select("email")
      .eq("email",user.email.toLowerCase()).eq("is_active",true).maybeSingle();
    if (allowError || !allowed) return reply(403,{error:"This email is not approved for the importer."});
    const body = await req.json();
    if (body.action === "list_batches") {
      const {data,error} = await db.from("import_batches").select("*").order("created_at",{ascending:false}).limit(25);
      if (error) throw error; return reply(200,{batches:data || []});
    }
    if (body.action === "create_batch") {
      const name = clean(body.name,120);
      const urls = Array.isArray(body.urls) ? [...new Set(body.urls.map((x:unknown)=>clean(x,2048)).filter(Boolean))] : [];
      if (!name || !urls.length || urls.length > 5) return reply(400,{error:"Enter a batch name and 1–5 product-page URLs."});
      const {data:batch,error:batchError} = await db.from("import_batches").insert({
        name,status:"running",created_by:user.id,
        requested_brands:Array.isArray(body.brands)?body.brands.map((x:unknown)=>clean(x,100)).filter(Boolean).slice(0,20):[],
        requested_product_families:Array.isArray(body.families)?body.families.map((x:unknown)=>clean(x,120)).filter(Boolean).slice(0,20):[],
      }).select("*").single();
      if (batchError) throw batchError;
      const results = [];
      for (const raw of urls as string[]) {
        try {
          const checked = await checkedUrl(raw);
          if (!await robotsAllows(checked)) throw new Error("robots.txt disallows this URL or could not be verified.");
          const fetched = await fetchHtml(checked.toString());
          const p = parsePage(fetched.html,fetched.url);
          const {data:source,error:sourceError} = await db.from("import_sources").insert({
            batch_id:batch.id,source_url:raw,canonical_url:p.canonical,source_type:"web",
            source_title:p.title,publisher:new URL(fetched.url).hostname,fetched_at:new Date().toISOString(),
            http_status:fetched.status,content_type:fetched.type,extracted_text:p.text,
            extraction_metadata:{method:"jsonld_and_html",title:p.title,h1:p.h1,description:p.description,final_url:fetched.url},
          }).select("*").single();
          if (sourceError) throw sourceError;
          let count = 0;
          for (const node of p.nodes) {
            const n = node as Record<string,unknown> | null;
            const b = n?.brand;
            const brand = typeof b === "string" ? b : b && typeof b === "object" ? clean((b as Record<string,unknown>).name,160) : null;
            const productName = clean(n?.name,240) || p.h1 || p.title;
            if (!productName) continue;
            const sku = clean(n?.sku ?? n?.mpn ?? n?.gtin13 ?? n?.gtin14,100);
            const payload = {
              name:productName,brand,description:clean(n?.description,2000) || p.description,
              sku,model:clean(n?.model,160),category:clean(n?.category,120),
              manufacturer:clean(typeof n?.manufacturer === "object" && n?.manufacturer ? (n.manufacturer as Record<string,unknown>).name : n?.manufacturer,160),
            };
            const evidence:Record<string,unknown> = {};
            for (const [key,value] of Object.entries(payload)) if (value) evidence[key] = {
              source_id:source.id,extraction_method:n ? "schema.org/Product" : "page_heading",evidence_excerpt:String(value).slice(0,240),
            };
            const {data:candidate,error:candidateError} = await db.from("import_candidates").insert({
              batch_id:batch.id,product_name:productName,brand,product_family:payload.model,sku,
              normalized_identity:identity(brand,productName,sku),normalized_payload:payload,field_evidence:evidence,
              confidence:n ? 0.72 : 0.35,status:"pending_review",
            }).select("*").single();
            if (candidateError) throw candidateError;
            await db.from("import_sources").update({candidate_id:candidate.id}).eq("id",source.id);
            const imgs = [...new Set([...images(n?.image),...p.images])].slice(0,10);
            if (imgs.length) {
              const {error:imageError} = await db.from("import_candidate_images").insert(imgs.map(image_url=>({
                candidate_id:candidate.id,source_id:source.id,image_url,source_page_url:fetched.url,
                rights_status:"unverified",review_status:"pending",
              })));
              if (imageError) throw imageError;
            }
            count++;
          }
          results.push({url:raw,ok:true,candidates_created:count,images_found:p.images.length,page_title:p.title});
        } catch (e) {
          results.push({url:raw,ok:false,error:e instanceof Error?e.message:"Import failed."});
        }
      }
      const good = results.filter(x=>x.ok).length;
      await db.from("import_batches").update({
        status:good?"review":"failed",summary:{submitted:urls.length,succeeded:good,failed:urls.length-good,results},
        updated_at:new Date().toISOString(),completed_at:new Date().toISOString(),
      }).eq("id",batch.id);
      return reply(200,{batch_id:batch.id,results});
    }
    if (body.action === "get_batch") {
      const id = clean(body.batch_id,80); if (!id) return reply(400,{error:"Batch ID required."});
      const [{data:batch,error:be},{data:candidates,error:ce}] = await Promise.all([
        db.from("import_batches").select("*").eq("id",id).single(),
        db.from("import_candidates").select("*, import_sources(*), import_candidate_images(*)").eq("batch_id",id).order("created_at"),
      ]);
      if (be) throw be; if (ce) throw ce; return reply(200,{batch,candidates:candidates || []});
    }
    if (body.action === "review_candidate") {
      const id = clean(body.candidate_id,80), status = body.status;
      if (!id || !["approved","rejected","pending_review"].includes(status)) return reply(400,{error:"Invalid review request."});
      const updates:Record<string,unknown> = {status,reviewed_by:user.id,reviewed_at:new Date().toISOString(),review_notes:clean(body.review_notes,1000)};
      if (body.product_name) updates.product_name = clean(body.product_name,240);
      if (body.brand !== undefined) updates.brand = clean(body.brand,160);
      if (body.normalized_payload && typeof body.normalized_payload === "object") updates.normalized_payload = body.normalized_payload;
      const {data,error} = await db.from("import_candidates").update(updates).eq("id",id).select("*").single();
      if (error) throw error; return reply(200,{candidate:data,message:status==="approved"?"Approved for staff catalog handoff; not published.":"Review saved."});
    }
    return reply(400,{error:"Unknown action."});
  } catch (e) {
    console.error(e);
    return reply(500,{error:e instanceof Error?e.message:"Importer failed."});
  }
});