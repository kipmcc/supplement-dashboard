-- Brand Name Normalization Script
-- Generated: 2026-01-30
-- Purpose: Standardize brand name variations to most common form

-- Preview changes first (run this to see what will be updated)
-- SELECT brand, COUNT(*) FROM canonical_products WHERE brand IN (...) GROUP BY brand;

BEGIN;

-- vitafusion: VitaFusion (18) <- Vitafusion (13), vitafusion (2)
UPDATE canonical_products SET brand = 'VitaFusion' WHERE brand IN ('Vitafusion', 'vitafusion');

-- econugenics: EcoNugenics (7) <- ecoNugenics (3), Econugenics (2)
UPDATE canonical_products SET brand = 'EcoNugenics' WHERE brand IN ('ecoNugenics', 'Econugenics');

-- allmax: ALLMAX (75) <- Allmax (9)
UPDATE canonical_products SET brand = 'ALLMAX' WHERE brand = 'Allmax';

-- aurora nutrascience: Aurora Nutrascience (17) <- Aurora NutraScience (2)
UPDATE canonical_products SET brand = 'Aurora Nutrascience' WHERE brand = 'Aurora NutraScience';

-- bioptimizers: BIOptimizers (11) <- BiOptimizers (3)
UPDATE canonical_products SET brand = 'BIOptimizers' WHERE brand = 'BiOptimizers';

-- biosil: Biosil (4) <- BioSil (1)
UPDATE canonical_products SET brand = 'Biosil' WHERE brand = 'BioSil';

-- evlution nutrition: EVLution Nutrition (104) <- Evlution Nutrition (5)
UPDATE canonical_products SET brand = 'EVLution Nutrition' WHERE brand = 'Evlution Nutrition';

-- bubs naturals: BUBS Naturals (2) <- Bubs Naturals (1)
UPDATE canonical_products SET brand = 'BUBS Naturals' WHERE brand = 'Bubs Naturals';

-- bulletproof: BulletProof (6) <- Bulletproof (4)
UPDATE canonical_products SET brand = 'Bulletproof' WHERE brand = 'BulletProof';  -- Use the more common capitalization

-- cardiotabs: Cardiotabs (5) <- CardioTabs (1)
UPDATE canonical_products SET brand = 'Cardiotabs' WHERE brand = 'CardioTabs';

-- designs for health: Designs for Health (328) <- Designs For Health (20)
UPDATE canonical_products SET brand = 'Designs for Health' WHERE brand = 'Designs For Health';

-- designs for sport: Designs For Sport (11) <- Designs for Sport (1)
UPDATE canonical_products SET brand = 'Designs for Sport' WHERE brand = 'Designs For Sport';

-- deva: Deva (28) <- DEVA (3)
UPDATE canonical_products SET brand = 'Deva' WHERE brand = 'DEVA';

-- blume: blume (3) <- Blume (1)
UPDATE canonical_products SET brand = 'Blume' WHERE brand = 'blume';  -- Capitalize properly

-- amen: AMEN (8) <- Amen (4)
UPDATE canonical_products SET brand = 'AMEN' WHERE brand = 'Amen';

-- frontier co-op: Frontier Co-op (19) <- Frontier Co-Op (1)
UPDATE canonical_products SET brand = 'Frontier Co-op' WHERE brand = 'Frontier Co-Op';

-- healthforce superfoods: HealthForce Superfoods (19) <- HealthForce SuperFoods (2)
UPDATE canonical_products SET brand = 'HealthForce Superfoods' WHERE brand = 'HealthForce SuperFoods';

-- airborne: Airborne (17) <- AirBorne (5)
UPDATE canonical_products SET brand = 'Airborne' WHERE brand = 'AirBorne';

-- naturewise: NatureWise (30) <- Naturewise (5)
UPDATE canonical_products SET brand = 'NatureWise' WHERE brand = 'Naturewise';

-- nobi nutrition: Nobi Nutrition (10) <- NOBI Nutrition (2)
UPDATE canonical_products SET brand = 'Nobi Nutrition' WHERE brand = 'NOBI Nutrition';

-- nutricology: NutriCology (37) <- Nutricology (22)
UPDATE canonical_products SET brand = 'NutriCology' WHERE brand = 'Nutricology';

-- olly: Olly (22) <- OLLY (16)
UPDATE canonical_products SET brand = 'OLLY' WHERE brand = 'Olly';  -- OLLY is their official branding

-- perfect sports: PERFECT Sports (8) <- Perfect Sports (2)
UPDATE canonical_products SET brand = 'PERFECT Sports' WHERE brand = 'Perfect Sports';

-- protocol for life balance: Protocol for Life Balance (101) <- Protocol For Life Balance (6)
UPDATE canonical_products SET brand = 'Protocol for Life Balance' WHERE brand = 'Protocol For Life Balance';

-- suku vitamins: SUKU Vitamins (8) <- Suku Vitamins (5)
UPDATE canonical_products SET brand = 'SUKU Vitamins' WHERE brand = 'Suku Vitamins';

-- sunfood: SunFood (7) <- Sunfood (4)
UPDATE canonical_products SET brand = 'Sunfood' WHERE brand = 'SunFood';  -- Sunfood is their official branding

-- xymogen: XYMOGEN (214) <- Xymogen (7)
UPDATE canonical_products SET brand = 'XYMOGEN' WHERE brand = 'Xymogen';

-- youtheory: Youtheory (37) <- YouTheory (2)
UPDATE canonical_products SET brand = 'Youtheory' WHERE brand = 'YouTheory';

-- zhou: Zhou (14) <- ZHOU (3)
UPDATE canonical_products SET brand = 'Zhou' WHERE brand = 'ZHOU';

-- zhou nutrition: Zhou Nutrition (31) <- ZHOU Nutrition (3)
UPDATE canonical_products SET brand = 'Zhou Nutrition' WHERE brand = 'ZHOU Nutrition';

-- life-flo: Life-flo (6) <- Life-Flo (2)
UPDATE canonical_products SET brand = 'Life-flo' WHERE brand = 'Life-Flo';

-- lifetime: Lifetime (12) <- LifeTime (1)
UPDATE canonical_products SET brand = 'Lifetime' WHERE brand = 'LifeTime';

-- innate response formulas: Innate Response Formulas (5) <- INNATE Response Formulas (1)
UPDATE canonical_products SET brand = 'Innate Response Formulas' WHERE brand = 'INNATE Response Formulas';

-- ac grace: AC Grace (2) <- A.C. Grace (1)
UPDATE canonical_products SET brand = 'AC Grace' WHERE brand = 'A.C. Grace';

-- san: SAN (3) <- San (2)
UPDATE canonical_products SET brand = 'SAN' WHERE brand = 'San';

-- nuun: Nuun (2) <- NUUN (1)
UPDATE canonical_products SET brand = 'Nuun' WHERE brand = 'NUUN';

-- pure co: Pure Co. (3) <- Pure Co (1)
UPDATE canonical_products SET brand = 'Pure Co.' WHERE brand = 'Pure Co';

-- well at walgreens: Well At Walgreens (5) <- Well at Walgreens (1)
UPDATE canonical_products SET brand = 'Well at Walgreens' WHERE brand = 'Well At Walgreens';

COMMIT;

-- Verify results
SELECT 'Brand normalization complete. Run this to verify:' as status;
-- SELECT brand, COUNT(*) FROM canonical_products GROUP BY brand ORDER BY COUNT(*) DESC LIMIT 50;
