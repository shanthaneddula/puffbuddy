"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { getSupabase } from "./lib/supabase";

const categoryIcons = {
  Vaporizers: "◉", Glass: "◇", "Papers & Wraps": "▤",
  Hookah: "◌", Accessories: "✳", Other: "＋"
};

function encodeShare(items) {
  const bytes = new TextEncoder().encode(JSON.stringify(items));
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary);
}

export default function Kiosk() {
  const [ageOk, setAgeOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [compare, setCompare] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [qr, setQr] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [request, setRequest] = useState({ product_name: "", brand: "", customer_note: "" });
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const supabase = useMemo(() => getSupabase(), []);

  useEffect(() => {
    setAgeOk(localStorage.getItem("puffbuddy-age-confirmed") === "yes");
    setReady(true);
    const params = new URLSearchParams(window.location.search);
    const share = params.get("share");
    if (share) {
      try {
        const binary = atob(share);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        setWishlist(JSON.parse(new TextDecoder().decode(bytes)).slice(0, 8));
      } catch { setNotice("This shared list could not be opened."); }
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    (async () => {
      const [catRes, productRes] = await Promise.all([
        supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("products").select("*, categories(name)").eq("is_active", true).order("sort_order").order("created_at", { ascending: false })
      ]);
      if (!alive) return;
      if (catRes.error || productRes.error) setNotice("Catalog could not load. Please ask a team member for help.");
      setCategories(catRes.data || []);
      setProducts(productRes.data || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [supabase]);

  const visible = useMemo(() => products.filter(p => {
    const matchesCategory = category === "All" || p.category_id === category;
    const haystack = [p.name, p.brand, p.series, p.description, p.categories?.name].join(" ").toLowerCase();
    return matchesCategory && haystack.includes(search.toLowerCase());
  }), [products, category, search]);

  function toggleCompare(product) {
    setCompare(current => current.some(p => p.id === product.id)
      ? current.filter(p => p.id !== product.id)
      : current.length < 3 ? [...current, product] : current);
    if (compare.length >= 3 && !compare.some(p => p.id === product.id)) setNotice("Compare up to three products at a time.");
  }

  async function makeQr() {
    const payload = encodeShare(wishlist.slice(0, 8).map(p => ({ id: p.id, name: p.name, brand: p.brand })));
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("share", payload);
    if (url.href.length > 1800) { setNotice("This list is too large to share as a QR code."); return; }
    try { setQr(await QRCode.toDataURL(url.href, { width: 280, margin: 2 })); }
    catch { setNotice("Could not create the QR code."); }
  }

  async function submitRequest(e) {
    e.preventDefault();
    if (!supabase) return setNotice("Catalog service is not configured.");
    const { error } = await supabase.from("product_requests").insert({
      product_name: request.product_name.trim(),
      brand: request.brand.trim() || null,
      customer_note: request.customer_note.trim() || null,
      source: "kiosk"
    });
    if (error) setNotice("Request could not be sent. Please ask a team member.");
    else { setNotice("Thanks! Your product request was sent."); setRequestOpen(false); setRequest({ product_name: "", brand: "", customer_note: "" }); }
  }

  if (!ready) return null;
  if (!ageOk) return <main className="age-screen"><div className="age-card"><div className="wordmark">PUFFBUDDY</div><p className="eyebrow">WELCOME IN</p><h1>Explore what’s in store.</h1><p className="muted">This product discovery experience is intended for adults of legal age.</p><button className="primary wide" onClick={() => { localStorage.setItem("puffbuddy-age-confirmed", "yes"); setAgeOk(true); }}>I am 21 or older</button><p className="fine">By continuing, you confirm that you are at least 21 years old.</p></div></main>;

  return <main className="shell">
    <header className="topbar"><div className="wordmark">PUFFBUDDY<span>PRODUCT DISCOVERY</span></div><div className="top-actions"><span className="status-dot"/> IN-STORE CATALOG <a href="/admin" className="staff-link">STAFF</a></div></header>
    {notice && <button className="notice" onClick={() => setNotice("")}>{notice} <b>×</b></button>}
    <section className="hero"><div><p className="eyebrow">TAKE A LOOK AROUND</p><h1>Find your next<br/><em>favorite.</em></h1><p className="muted">Explore products, discover details, and compare your options.</p></div><button className="request-link" onClick={() => setRequestOpen(true)}>Can’t find something? <b>Request a product ↗</b></button></section>
    <section className="catalog">
      <div className="section-head"><div><p className="eyebrow">THE COLLECTION</p><h2>Browse the catalog</h2></div><span className="count">{visible.length} PRODUCTS</span></div>
      <div className="toolbar"><div className="search-wrap"><span>⌕</span><input aria-label="Search products" placeholder="Search products or brands" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="filters"><button className={category === "All" ? "filter active" : "filter"} onClick={() => setCategory("All")}>All</button>{categories.map(c => <button key={c.id} className={category === c.id ? "filter active" : "filter"} onClick={() => setCategory(c.id)}>{c.name}</button>)}</div></div>
      {loading ? <div className="empty">Loading the catalog…</div> : !supabase ? <div className="empty">Catalog connection is not configured yet. Add the Supabase environment variables to get started.</div> : visible.length === 0 ? <div className="empty">No products found. Try another search or request an item.</div> :
        <div className="product-grid">{visible.map(p => <article className="product-card" key={p.id}><button className="product-image" onClick={() => setSelected(p)} aria-label={"View " + p.name}><img src={p.image_url || "/product-placeholder.svg"} alt={p.name} loading="lazy"/><span>VIEW DETAILS ↗</span></button><div className="product-info"><p className="eyebrow">{p.brand || p.categories?.name || "IN STORE"}</p><h3>{p.name}</h3>{p.series && <p className="series">{p.series}</p>}<div className="card-bottom"><button onClick={() => setSelected(p)}>Explore product ↗</button><button className={wishlist.some(x => x.id === p.id) ? "icon-button saved" : "icon-button"} onClick={() => setWishlist(v => v.some(x => x.id === p.id) ? v.filter(x => x.id !== p.id) : v.length < 8 ? [...v, p] : v)} aria-label="Save to list">♡</button></div></div></article>)}</div>}
    </section>
    {compare.length > 0 && <aside className="compare-bar"><div><b>{compare.length} selected to compare</b><span>Choose up to 3 products</span></div>{compare.map(p => <span className="compare-chip" key={p.id}>{p.name}</span>)}<button className="primary" onClick={() => setSelected({ compareView: true })}>Compare</button><button className="text-button" onClick={() => setCompare([])}>Clear</button></aside>}
    {wishlist.length > 0 && <aside className="wishlist-bar"><span>{wishlist.length} items in your list</span><button onClick={makeQr}>Create share QR</button><button className="text-button" onClick={() => {setWishlist([]);setQr("");}}>Clear</button>{qr && <div className="qr-pop"><img src={qr} alt="QR code for your product list"/><small>Scan to open this list</small></div>}</aside>}
    {(selected && !selected.compareView) && <div className="overlay" onClick={() => setSelected(null)}><section className="detail-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelected(null)}>×</button><div className="detail-image"><img src={selected.image_url || "/product-placeholder.svg"} alt={selected.name}/></div><div className="detail-copy"><p className="eyebrow">{selected.brand || "PRODUCT DETAILS"}</p><h2>{selected.name}</h2>{selected.series && <p className="series">{selected.series}</p>}<p>{selected.description || "Ask a team member for more information about this product."}</p>{selected.highlights?.length > 0 && <ul>{selected.highlights.map((h,i)=><li key={i}>{h}</li>)}</ul>}{selected.specs && Object.keys(selected.specs).length > 0 && <div className="specs">{Object.entries(selected.specs).map(([k,v])=><div key={k}><span>{k}</span><b>{String(v)}</b></div>)}</div>}<div className="detail-actions"><button className="primary" onClick={() => toggleCompare(selected)}> {compare.some(p => p.id === selected.id) ? "Remove from compare" : "Add to compare"}</button><button className="secondary" onClick={() => setWishlist(v => v.some(x => x.id === selected.id) ? v.filter(x => x.id !== selected.id) : v.length < 8 ? [...v, selected] : v)}>♡ Save to list</button></div></div></section></div>}
    {selected?.compareView && <div className="overlay" onClick={() => setSelected(null)}><section className="compare-modal" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSelected(null)}>×</button><p className="eyebrow">SIDE BY SIDE</p><h2>Compare products</h2><div className="compare-table">{compare.map(p=><div key={p.id}><img src={p.image_url || "/product-placeholder.svg"} alt=""/><h3>{p.name}</h3><p>{p.brand}</p>{Object.entries(p.specs || {}).map(([k,v])=><p key={k}><b>{k}:</b> {String(v)}</p>)}</div>)}</div></section></div>}
    {requestOpen && <div className="overlay" onClick={() => setRequestOpen(false)}><form className="request-modal" onSubmit={submitRequest} onClick={e=>e.stopPropagation()}><button type="button" className="close" onClick={()=>setRequestOpen(false)}>×</button><p className="eyebrow">LET US KNOW</p><h2>Request a product</h2><label>Product name<input required maxLength="120" value={request.product_name} onChange={e=>setRequest({...request,product_name:e.target.value})}/></label><label>Brand (optional)<input maxLength="120" value={request.brand} onChange={e=>setRequest({...request,brand:e.target.value})}/></label><label>Anything else? <textarea maxLength="1000" value={request.customer_note} onChange={e=>setRequest({...request,customer_note:e.target.value})}/></label><button className="primary wide">Send request</button></form></div>}
    <footer><span>PUFFBUDDY</span><span>Discover. Compare. Find your fit.</span></footer>
  </main>;
}
