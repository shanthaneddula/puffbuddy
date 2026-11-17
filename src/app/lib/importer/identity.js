/**
 * Deterministic identity helpers for importer duplicate screening.
 *
 * This module only proposes review matches. It never merges or writes catalog rows.
 */

export function normalizeIdentityPart(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildProductIdentity(product = {}) {
  return {
    brand: normalizeIdentityPart(product.brand),
    model: normalizeIdentityPart(product.model ?? product.series ?? product.name),
    variant: normalizeIdentityPart(product.variant),
    sku: normalizeIdentityPart(product.sku ?? product.gtin ?? ""),
  };
}

function bigrams(value) {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length < 2) return new Set(compact ? [compact] : []);
  const pairs = new Set();
  for (let i = 0; i < compact.length - 1; i += 1) {
    pairs.add(compact.slice(i, i + 2));
  }
  return pairs;
}

function diceSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = bigrams(left);
  const b = bigrams(right);
  let overlap = 0;
  for (const pair of a) if (b.has(pair)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

/**
 * Returns a review classification, not an automatic duplicate decision.
 * A same-family/different-variant match is deliberately not treated as a duplicate.
 */
export function compareProductIdentity(candidate = {}, existing = {}) {
  const incoming = buildProductIdentity(candidate);
  const current = buildProductIdentity(existing);

  if (incoming.sku && current.sku && incoming.sku === current.sku) {
    return { kind: "exact_sku", score: 1, reviewRequired: true, reason: "SKU/GTIN matches exactly." };
  }

  if (incoming.brand && current.brand && incoming.brand === current.brand &&
      incoming.model && current.model && incoming.model === current.model) {
    if (incoming.variant && current.variant && incoming.variant !== current.variant) {
      return {
        kind: "same_family_different_variant",
        score: 0.98,
        reviewRequired: true,
        reason: "Brand and model match, but the variants differ. Keep separate unless staff confirms otherwise.",
      };
    }
    if (incoming.variant === current.variant) {
      return {
        kind: "exact_model_variant",
        score: 1,
        reviewRequired: true,
        reason: "Brand, model, and variant identity match.",
      };
    }
    return {
      kind: "same_family_variant_unspecified",
      score: 0.9,
      reviewRequired: true,
      reason: "Brand and model match, but one or both variant values are missing.",
    };
  }

  const brandScore = diceSimilarity(incoming.brand, current.brand);
  const modelScore = diceSimilarity(incoming.model, current.model);
  const score = Number((brandScore * 0.35 + modelScore * 0.65).toFixed(3));
  const likely = Boolean(incoming.brand && current.brand && incoming.model && current.model && score >= 0.78);

  return {
    kind: likely ? "fuzzy_candidate" : "no_strong_match",
    score,
    reviewRequired: likely,
    reason: likely
      ? "Brand/model text is similar; staff must inspect the records before deciding."
      : "No strong deterministic identity match found.",
  };
}
