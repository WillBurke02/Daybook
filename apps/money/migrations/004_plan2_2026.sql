-- Plan 2 student loan threshold for 2026/27 is £29,385 (£28,470 was 2025/26's, seeded here by mistake).
-- Only the seeded figure moves: a band you have changed yourself is left as it is.
UPDATE rate_band SET upper = 29385 WHERE tax_year = 2026 AND kind = 'plan2' AND lower = 0 AND upper = 28470;
UPDATE rate_band SET lower = 29385 WHERE tax_year = 2026 AND kind = 'plan2' AND lower = 28470;
