import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIdentityPart,
  buildProductIdentity,
  compareProductIdentity,
} from "./identity.mjs";

test("normalizes accents, punctuation, ampersands, and spacing", () => {
  assert.equal(normalizeIdentityPart("  GRAV® & Co.  "), "grav and co");
  assert.equal(normalizeIdentityPart("PÜFF-X2"), "puff x2");
});

test("builds a normalized product identity", () => {
  assert.deepEqual(buildProductIdentity({
    brand: "Geek Bar",
    series: "Pulse X",
    variant: "Blue Razz",
    sku: "GB-PX-001",
  }), {
    brand: "geek bar",
    model: "pulse x",
    variant: "blue razz",
    sku: "gb px 001",
  });
});

test("flags exact model and variant as a review candidate, never an auto-merge", () => {
  const result = compareProductIdentity(
    { brand: "Geek Bar", model: "Pulse X", variant: "Blue Razz" },
    { brand: "Geek Bar", model: "Pulse X", variant: "Blue Razz" },
  );
  assert.equal(result.kind, "exact_model_variant");
  assert.equal(result.reviewRequired, true);
});

test("keeps different variants distinct while flagging the shared family", () => {
  const result = compareProductIdentity(
    { brand: "Geek Bar", model: "Pulse X", variant: "Blue Razz" },
    { brand: "Geek Bar", model: "Pulse X", variant: "Watermelon Ice" },
  );
  assert.equal(result.kind, "same_family_different_variant");
  assert.equal(result.reviewRequired, true);
});

test("treats missing variant data as ambiguous rather than an exact duplicate", () => {
  const result = compareProductIdentity(
    { brand: "Geek Bar", model: "Pulse X" },
    { brand: "Geek Bar", model: "Pulse X", variant: "Blue Razz" },
  );
  assert.equal(result.kind, "same_family_variant_unspecified");
  assert.equal(result.reviewRequired, true);
});

test("exact SKU/GTIN match takes precedence", () => {
  const result = compareProductIdentity(
    { brand: "Brand A", model: "Model 1", sku: "SKU-100" },
    { brand: "Brand B", model: "Model 2", sku: "SKU-100" },
  );
  assert.equal(result.kind, "exact_sku");
  assert.equal(result.score, 1);
});

test("does not call unrelated products duplicates", () => {
  const result = compareProductIdentity(
    { brand: "Geek Bar", model: "Pulse X" },
    { brand: "GRAV", model: "Helix Beaker" },
  );
  assert.equal(result.kind, "no_strong_match");
  assert.equal(result.reviewRequired, false);
});
