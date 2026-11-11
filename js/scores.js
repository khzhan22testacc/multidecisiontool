// Scoring rules. Each score names the canonical variables it needs and how to
// turn them into a result. No score defines its own inputs.
//
// compute(v) returns:
//   { value, tier, summary, parts?, lines?, note? }
//   tier: 'low' | 'mod' | 'high' | 'info'  (colour only; summary carries the meaning)
//   parts: [[label, points]] for additive scores
//   lines: [[label, text]] for extra computed outputs

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pts = n => `${n} ${Math.abs(n) === 1 ? 'point' : 'points'}`;
const sum = parts => parts.reduce((a, p) => a + p[1], 0);
// Build a parts list from [label, condition, points] rows, keeping every row
// so the user can see what was and was not counted.
const tally = rows => rows.map(([label, cond, p]) => [label, cond ? p : 0]);

// Unit conversions (app stores SI).
const crMg = cr => cr / 88.4;
const biliMg = b => b / 17.1;
const cholMg = c => c * 38.67;


// Shared calculations
function egfr(v) { // CKD-EPI 2021, creatinine in µmol/L
  const f = v.sex === 'F', k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302, s = crMg(v.cr) / k;
  return 142 * Math.pow(Math.min(s, 1), a) * Math.pow(Math.max(s, 1), -1.2) * Math.pow(0.9938, v.age) * (f ? 1.012 : 1);
}
const gCat = e => e >= 90 ? 'G1' : e >= 60 ? 'G2' : e >= 45 ? 'G3a' : e >= 30 ? 'G3b' : e >= 15 ? 'G4' : 'G5';
const aCat = acr => acr < 3 ? 'A1' : acr <= 30 ? 'A2' : 'A3';
function tbwFraction(v) { // Total body water as a fraction of weight
  const old = v.age >= 65;
  return v.sex === 'F' ? (old ? 0.45 : 0.5) : (old ? 0.5 : 0.6);
}
function ibwKg(v) { // Devine
  const inchesOver60 = v.height / 2.54 - 60;
  return (v.sex === 'F' ? 45.5 : 50) + 2.3 * inchesOver60;
}
const ureaToBun = u => u * 2.8;          // mmol/L -> mg/dL
const pct = x => `${x < 1 && x > 0 ? r1(x) : Math.round(x * 10) / 10}%`;

export const CATEGORIES = [
  { id: 'cardio', label: 'Cardiology' },
  { id: 'vte', label: 'Thrombosis' },
  { id: 'resp', label: 'Respirology and sepsis' },
  { id: 'gi', label: 'GI and hepatology' },
  { id: 'kidney', label: 'Kidney' },
  { id: 'acidbase', label: 'Acid–base' },
  { id: 'lytes', label: 'Electrolytes and fluids' },
  { id: 'body', label: 'Body weight' },
  { id: 'rheum', label: 'Rheumatology' },
];

export const SCORES = [
  // ------------------------------------------------------------ Cardiology
  {
    id: 'frs', name: 'Framingham Risk Score', cat: 'cardio',
    about: '10-year risk of cardiovascular disease (D\'Agostino 2008), with CCS family-history adjustment.',
    needs: ['age', 'sex', 'tc', 'hdl', 'sbp', 'bpTreated', 'smoker', 'diabetes', 'famHxCvd'],
    compute(v) {
      const male = v.sex === 'M';
      const lnAge = Math.log(v.age), lnTc = Math.log(cholMg(v.tc)),
        lnHdl = Math.log(cholMg(v.hdl)), lnSbp = Math.log(v.sbp);
      let s, risk;
      if (male) {
        s = 3.06117 * lnAge + 1.12370 * lnTc - 0.93263 * lnHdl +
          (v.bpTreated ? 1.99881 : 1.93303) * lnSbp +
          (v.smoker ? 0.65451 : 0) + (v.diabetes ? 0.57367 : 0);
        risk = 1 - Math.pow(0.88936, Math.exp(s - 23.9802));
      } else {
        s = 2.32888 * lnAge + 1.20904 * lnTc - 0.70833 * lnHdl +
          (v.bpTreated ? 2.82263 : 2.76157) * lnSbp +
          (v.smoker ? 0.52873 : 0) + (v.diabetes ? 0.69154 : 0);
        risk = 1 - Math.pow(0.95012, Math.exp(s - 26.1931));
      }
      const base = risk * 100;
      const adj = Math.min(100, v.famHxCvd ? base * 2 : base);
      const tier = adj < 10 ? 'low' : adj < 20 ? 'mod' : 'high';
      const cat = adj < 10 ? 'Low risk (<10%)' : adj < 20 ? 'Intermediate risk (10–19.9%)' : 'High risk (≥20%)';
      const fmt = x => (x >= 30 ? '>30%' : `${r1(x)}%`);
      const lines = [['10-year CVD risk', fmt(base)]];
      if (v.famHxCvd) lines.push(['Doubled for family history (CCS)', fmt(adj)]);
      const warn = (v.age < 30 || v.age > 74) ? 'Validated for ages 30–74. ' : '';
      return {
        value: fmt(adj), tier, summary: cat, lines,
        note: warn + 'Statin-indicated conditions (clinical ASCVD, most diabetes, CKD, LDL ≥5) do not need a risk score.',
      };
    },
  },
  {
    id: 'heart', name: 'HEART Score', cat: 'cardio',
    about: 'Risk of major adverse cardiac events in ED chest pain.',
    needs: ['heartHistory', 'heartEcg', 'age', 'heartRf', 'heartTrop'],
    compute(v) {
      const parts = [
        ['History', +v.heartHistory], ['ECG', +v.heartEcg],
        ['Age', v.age >= 65 ? 2 : v.age >= 45 ? 1 : 0],
        ['Risk factors', +v.heartRf], ['Troponin', +v.heartTrop],
      ];
      const t = sum(parts);
      const tier = t <= 3 ? 'low' : t <= 6 ? 'mod' : 'high';
      const summary = t <= 3 ? 'Low risk. 6-week MACE about 1–2%.'
        : t <= 6 ? 'Moderate risk. 6-week MACE about 12–17%.'
          : 'High risk. 6-week MACE about 50–65%.';
      return { value: pts(t), tier, summary, parts };
    },
  },
  {
    id: 'chads', name: 'CHA₂DS₂-VASc and CHADS-65', cat: 'cardio',
    about: 'Stroke risk in non-valvular atrial fibrillation.',
    needs: ['age', 'sex', 'chf', 'htn', 'diabetes', 'strokeTia', 'vascDz'],
    compute(v) {
      const parts = [
        ['Heart failure', v.chf ? 1 : 0], ['Hypertension', v.htn ? 1 : 0],
        ['Age', v.age >= 75 ? 2 : v.age >= 65 ? 1 : 0], ['Diabetes', v.diabetes ? 1 : 0],
        ['Stroke / TIA / embolism', v.strokeTia ? 2 : 0], ['Vascular disease', v.vascDz ? 1 : 0],
        ['Female sex', v.sex === 'F' ? 1 : 0],
      ];
      const t = sum(parts);
      const nonSex = t - (v.sex === 'F' ? 1 : 0);
      const chads2 = (v.chf ? 1 : 0) + (v.htn ? 1 : 0) + (v.age >= 75 ? 1 : 0) + (v.diabetes ? 1 : 0) + (v.strokeTia ? 2 : 0);
      const ccs = (v.age >= 65 || v.strokeTia || v.htn || v.chf || v.diabetes)
        ? 'Oral anticoagulation recommended'
        : v.vascDz ? 'Antiplatelet therapy (no OAC indication)' : 'No antithrombotic therapy';
      const tier = nonSex === 0 ? 'low' : nonSex === 1 ? 'mod' : 'high';
      const summary = nonSex === 0 ? 'Low stroke risk. Anticoagulation generally not needed.'
        : nonSex === 1 ? 'One non-sex risk factor. Anticoagulation should be considered.'
          : 'Anticoagulation recommended.';
      return {
        value: pts(t), tier, summary, parts,
        lines: [['CHADS₂', pts(chads2)], ['CCS CHADS-65 pathway', ccs]],
      };
    },
  },
  {
    id: 'hasbled', name: 'HAS-BLED', cat: 'cardio',
    about: 'Major bleeding risk on anticoagulation for atrial fibrillation.',
    needs: ['sbp', 'age', 'hbRenal', 'hbLiver', 'strokeTia', 'hbBleed', 'labileInr', 'hbDrugs', 'hbAlcohol'],
    compute(v) {
      const parts = tally([
        ['Uncontrolled hypertension (SBP >160)', v.sbp > 160, 1],
        ['Abnormal renal function', v.hbRenal, 1], ['Abnormal liver function', v.hbLiver, 1],
        ['Prior stroke', v.strokeTia, 1], ['Bleeding history or predisposition', v.hbBleed, 1],
        ['Labile INR', v.labileInr, 1], ['Age >65', v.age > 65, 1],
        ['Antiplatelet or NSAID', v.hbDrugs, 1], ['Alcohol', v.hbAlcohol, 1],
      ]);
      const t = sum(parts);
      return {
        value: pts(t), tier: t >= 3 ? 'high' : t === 2 ? 'mod' : 'low', parts,
        summary: t >= 3 ? 'High bleeding risk. Address modifiable factors and follow closely. Not by itself a reason to withhold anticoagulation.'
          : 'Low to moderate bleeding risk.',
        note: 'The stroke item here uses the shared "prior stroke, TIA or systemic embolism" answer.',
      };
    },
  },

  // ------------------------------------------------------------ Thrombosis
  {
    id: 'wellspe', name: 'Wells Score for PE', cat: 'vte',
    about: 'Pretest probability of pulmonary embolism.',
    needs: ['dvtSigns', 'peLikely', 'hr', 'immobSurgPe', 'priorVte', 'hemoptysis', 'cancer'],
    compute(v) {
      const parts = tally([
        ['Clinical signs of DVT', v.dvtSigns, 3], ['PE most likely diagnosis', v.peLikely, 3],
        ['Heart rate >100', v.hr > 100, 1.5], ['Immobilization or recent surgery', v.immobSurgPe, 1.5],
        ['Prior DVT or PE', v.priorVte, 1.5], ['Hemoptysis', v.hemoptysis, 1], ['Active cancer', v.cancer, 1],
      ]);
      const t = sum(parts);
      const three = t < 2 ? 'low' : t <= 6 ? 'moderate' : 'high';
      return {
        value: pts(t), tier: t > 4 ? 'high' : 'low', parts,
        summary: t > 4 ? 'PE likely (>4). Proceed to imaging.' : 'PE unlikely (≤4). D-dimer to rule out.',
        lines: [['Three-tier model', `${three} probability`]],
      };
    },
  },
  {
    id: 'perc', name: 'PERC Rule', cat: 'vte',
    about: 'Rules out PE without D-dimer when pretest probability is low (<15%).',
    needs: ['age', 'hr', 'spo2', 'legSwelling', 'hemoptysis', 'surgTrauma4w', 'priorVte', 'estrogen'],
    compute(v) {
      const parts = tally([
        ['Age ≥50', v.age >= 50, 1], ['Heart rate ≥100', v.hr >= 100, 1], ['SpO2 <95%', v.spo2 < 95, 1],
        ['Unilateral leg swelling', v.legSwelling, 1], ['Hemoptysis', v.hemoptysis, 1],
        ['Recent surgery or trauma', v.surgTrauma4w, 1], ['Prior DVT or PE', v.priorVte, 1],
        ['Estrogen use', v.estrogen, 1],
      ]);
      const t = sum(parts);
      return {
        value: t === 0 ? 'Negative' : `Positive (${t})`, tier: t === 0 ? 'low' : 'mod', parts,
        summary: t === 0 ? 'All 8 criteria absent. If clinical gestalt is low (<15%), no further PE testing is needed.'
          : 'PERC cannot rule out PE. Continue with D-dimer or imaging according to pretest probability.',
      };
    },
  },
  {
    id: 'wellsdvt', name: 'Wells Score for DVT', cat: 'vte',
    about: 'Pretest probability of deep vein thrombosis.',
    needs: ['cancer', 'dvtParalysis', 'dvtBedridden', 'dvtTender', 'dvtEntireLeg', 'dvtCalf3cm',
      'dvtPitting', 'dvtCollateral', 'priorDvt', 'dvtAltDx'],
    compute(v) {
      const parts = tally([
        ['Active cancer', v.cancer, 1], ['Paralysis, paresis or cast', v.dvtParalysis, 1],
        ['Bedridden or major surgery', v.dvtBedridden, 1], ['Deep vein tenderness', v.dvtTender, 1],
        ['Entire leg swollen', v.dvtEntireLeg, 1], ['Calf swelling >3 cm', v.dvtCalf3cm, 1],
        ['Pitting edema', v.dvtPitting, 1], ['Collateral superficial veins', v.dvtCollateral, 1],
        ['Previous DVT', v.priorDvt, 1], ['Alternative diagnosis as likely', v.dvtAltDx, -2],
      ]);
      const t = sum(parts);
      return {
        value: pts(t), tier: t >= 2 ? 'high' : 'low', parts,
        summary: t >= 2 ? 'DVT likely (≥2). Proceed to compression ultrasound.' : 'DVT unlikely (<2). D-dimer to rule out.',
      };
    },
  },

  // ------------------------------------------------------------ Resp / sepsis
  {
    id: 'curb65', name: 'CURB-65', cat: 'resp',
    about: 'Severity of community-acquired pneumonia.',
    needs: ['ams', 'urea', 'rr', 'sbp', 'dbp', 'age'],
    compute(v) {
      const parts = tally([
        ['Confusion', v.ams, 1], ['Urea >7 mmol/L', v.urea > 7, 1], ['Respiratory rate ≥30', v.rr >= 30, 1],
        ['SBP <90 or DBP ≤60', v.sbp < 90 || v.dbp <= 60, 1], ['Age ≥65', v.age >= 65, 1],
      ]);
      const t = sum(parts);
      return {
        value: pts(t), tier: t <= 1 ? 'low' : t === 2 ? 'mod' : 'high', parts,
        summary: t <= 1 ? 'Low severity (30-day mortality about 1.5%). Outpatient treatment may be suitable.'
          : t === 2 ? 'Moderate severity (30-day mortality about 9%). Consider admission.'
            : 'Severe pneumonia (30-day mortality about 22%). Admit; consider ICU if 4–5.',
      };
    },
  },
  {
    id: 'qsofa', name: 'qSOFA', cat: 'resp',
    about: 'Bedside prompt for poor outcome in suspected infection.',
    needs: ['rr', 'ams', 'sbp'],
    compute(v) {
      const parts = tally([
        ['Respiratory rate ≥22', v.rr >= 22, 1], ['Altered mentation', v.ams, 1], ['SBP ≤100', v.sbp <= 100, 1],
      ]);
      const t = sum(parts);
      return {
        value: pts(t), tier: t >= 2 ? 'high' : 'low', parts,
        summary: t >= 2 ? 'Positive (≥2). Higher risk of death or prolonged ICU stay; assess for organ dysfunction.'
          : 'Negative (<2). Does not exclude sepsis.',
        note: 'Surviving Sepsis 2021 advises against qSOFA as a sole screening tool.',
      };
    },
  },

  // ------------------------------------------------------------ GI / hepatology
  {
    id: 'gbs', name: 'Glasgow-Blatchford Score', cat: 'gi',
    about: 'Need for intervention in upper GI bleeding.',
    needs: ['urea', 'hb', 'sex', 'sbp', 'hr', 'melena', 'syncope', 'hepaticDz', 'chf'],
    compute(v) {
      const u = v.urea, h = v.hb, s = v.sbp;
      const ureaP = u >= 25 ? 6 : u >= 10 ? 4 : u >= 8 ? 3 : u >= 6.5 ? 2 : 0;
      const hbP = v.sex === 'M'
        ? (h < 100 ? 6 : h < 120 ? 3 : h < 130 ? 1 : 0)
        : (h < 100 ? 6 : h < 120 ? 1 : 0);
      const sbpP = s < 90 ? 3 : s < 100 ? 2 : s < 110 ? 1 : 0;
      const parts = [
        ['Urea', ureaP], ['Hemoglobin', hbP], ['Systolic BP', sbpP],
        ['Heart rate ≥100', v.hr >= 100 ? 1 : 0], ['Melena', v.melena ? 1 : 0],
        ['Syncope', v.syncope ? 2 : 0], ['Liver disease', v.hepaticDz ? 2 : 0], ['Heart failure', v.chf ? 2 : 0],
      ];
      const t = sum(parts);
      return {
        value: pts(t), tier: t <= 1 ? 'low' : t <= 5 ? 'mod' : 'high', parts,
        summary: t <= 1 ? 'Very low risk (0–1). Outpatient management can be considered.'
          : 'Not low risk. Admit for endoscopy; risk of transfusion or intervention rises with the score.',
      };
    },
  },
  {
    id: 'meld', name: 'MELD-Na and MELD 3.0', cat: 'gi',
    about: 'Three-month mortality in end-stage liver disease.',
    needs: ['bili', 'inr', 'cr', 'na', 'albumin', 'sex', 'dialysis'],
    compute(v) {
      const b = Math.max(1, biliMg(v.bili)), i = Math.max(1, v.inr), na = clamp(v.na, 125, 137);
      // MELD-Na (OPTN 2016)
      const c4 = v.dialysis ? 4 : clamp(crMg(v.cr), 1, 4);
      const mi = r1(10 * (0.957 * Math.log(c4) + 0.378 * Math.log(b) + 1.120 * Math.log(i) + 0.643));
      let meldNa = mi > 11 ? mi + 1.32 * (137 - na) - 0.033 * mi * (137 - na) : mi;
      meldNa = clamp(Math.round(meldNa), 6, 40);
      // MELD 3.0 (Kim 2021)
      const c3 = v.dialysis ? 3 : clamp(crMg(v.cr), 1, 3);
      const alb = clamp(v.albumin / 10, 1.5, 3.5);
      let m3 = 1.33 * (v.sex === 'F' ? 1 : 0) + 4.56 * Math.log(b) + 0.82 * (137 - na) -
        0.24 * (137 - na) * Math.log(b) + 9.09 * Math.log(i) + 11.14 * Math.log(c3) +
        1.85 * (3.5 - alb) - 1.83 * (3.5 - alb) * Math.log(c3) + 6;
      m3 = clamp(Math.round(m3), 6, 40);
      const mort = m => m < 10 ? 'about 2%' : m < 20 ? 'about 6%' : m < 30 ? 'about 20%' : m < 40 ? 'about 50%' : 'about 70%';
      return {
        value: `${meldNa}`, tier: meldNa < 10 ? 'low' : meldNa < 20 ? 'mod' : 'high',
        summary: `MELD-Na ${meldNa}. Three-month mortality ${mort(meldNa)}.`,
        lines: [['MELD-Na', `${meldNa}`], ['MELD 3.0', `${m3}`], ['MELD without sodium', `${clamp(Math.round(mi), 6, 40)}`]],
      };
    },
  },
  {
    id: 'childpugh', name: 'Child-Pugh', cat: 'gi',
    about: 'Severity and prognosis of cirrhosis.',
    needs: ['bili', 'albumin', 'inr', 'ascites', 'enceph'],
    compute(v) {
      const parts = [
        ['Bilirubin', v.bili < 34 ? 1 : v.bili <= 50 ? 2 : 3],
        ['Albumin', v.albumin > 35 ? 1 : v.albumin >= 28 ? 2 : 3],
        ['INR', v.inr < 1.7 ? 1 : v.inr <= 2.3 ? 2 : 3],
        ['Ascites', { none: 1, slight: 2, moderate: 3 }[v.ascites]],
        ['Encephalopathy', { none: 1, g12: 2, g34: 3 }[v.enceph]],
      ];
      const t = sum(parts);
      const cls = t <= 6 ? 'A' : t <= 9 ? 'B' : 'C';
      return {
        value: `Class ${cls} (${t})`, tier: cls === 'A' ? 'low' : cls === 'B' ? 'mod' : 'high', parts,
        summary: cls === 'A' ? 'Well-compensated disease. One-year survival about 100%.'
          : cls === 'B' ? 'Significant functional compromise. One-year survival about 80%.'
            : 'Decompensated disease. One-year survival about 45%.',
      };
    },
  },
  {
    id: 'fib4', name: 'FIB-4', cat: 'gi',
    about: 'Non-invasive estimate of advanced liver fibrosis.',
    needs: ['age', 'ast', 'alt', 'plt'],
    compute(v) {
      const f = (v.age * v.ast) / (v.plt * Math.sqrt(v.alt));
      const lowCut = v.age >= 65 ? 2.0 : 1.3;
      const tier = f < lowCut ? 'low' : f > 2.67 ? 'high' : 'mod';
      return {
        value: `${r2(f)}`, tier,
        summary: tier === 'low' ? `Advanced fibrosis unlikely (<${lowCut}).`
          : tier === 'high' ? 'Advanced fibrosis likely (>2.67). Refer to hepatology.'
            : 'Indeterminate. Further testing such as elastography.',
        note: v.age < 35 ? 'Less reliable under age 35.' : (v.age >= 65 ? 'Lower cut-off raised to 2.0 for age ≥65.' : ''),
      };
    },
  },
  {
    id: 'rfactor', name: 'R Factor (liver injury pattern)', cat: 'gi',
    about: 'Hepatocellular vs cholestatic pattern of liver enzyme elevation.',
    needs: ['alt', 'alp', 'altUln', 'alpUln'],
    compute(v) {
      const r = (v.alt / v.altUln) / (v.alp / v.alpUln);
      const pat = r >= 5 ? 'Hepatocellular pattern (R ≥5).' : r <= 2 ? 'Cholestatic pattern (R ≤2).' : 'Mixed pattern (R 2–5).';
      return {
        value: `${r1(r)}`, tier: 'info', summary: pat,
        lines: [['ALT', `${r1(v.alt / v.altUln)}× ULN`], ['ALP', `${r1(v.alp / v.alpUln)}× ULN`]],
      };
    },
  },

  // ------------------------------------------------------------ Renal / lytes
  {
    id: 'ckdepi', name: 'eGFR (CKD-EPI 2021)', cat: 'kidney',
    about: 'Estimated GFR from creatinine, race-free equation.',
    needs: ['cr', 'age', 'sex'],
    compute(v) {
      const e = egfr(v), g = gCat(e);
      return {
        value: `${Math.round(e)}`, unit: 'mL/min/1.73 m²', tier: e >= 60 ? 'low' : e >= 30 ? 'mod' : 'high',
        summary: `GFR category ${g}.`, note: 'Assumes steady-state creatinine. Not valid in AKI.',
      };
    },
  },
  {
    id: 'cg', name: 'Creatinine Clearance (Cockcroft-Gault)', cat: 'kidney',
    about: 'Creatinine clearance for drug dosing.',
    needs: ['age', 'weight', 'cr', 'sex'],
    compute(v) {
      const c = ((140 - v.age) * v.weight * (v.sex === 'F' ? 0.85 : 1)) / (72 * crMg(v.cr));
      return {
        value: `${Math.round(c)}`, unit: 'mL/min', tier: c >= 60 ? 'low' : c >= 30 ? 'mod' : 'high',
        summary: 'Calculated with the weight entered.',
        note: 'Consider ideal or adjusted body weight in obesity. Assumes steady-state creatinine.',
      };
    },
  },
  {
    id: 'ag', name: 'Anion Gap', cat: 'acidbase',
    about: 'Anion gap with albumin correction and delta ratio.',
    needs: ['na', 'cl', 'hco3'], optional: ['albumin'],
    compute(v) {
      const ag = v.na - v.cl - v.hco3;
      const lines = [['Anion gap', `${r1(ag)} mmol/L`]];
      let eff = ag;
      if (v.albumin != null) {
        eff = ag + 0.25 * (40 - v.albumin);
        lines.push(['Albumin-corrected', `${r1(eff)} mmol/L`]);
      }
      if (eff > 12 && v.hco3 < 24) {
        const d = (eff - 12) / (24 - v.hco3);
        lines.push(['Delta ratio', `${r2(d)} ${d < 0.4 ? '(pure non-gap acidosis)' : d < 1 ? '(mixed gap and non-gap acidosis)' : d <= 2 ? '(pure gap acidosis)' : '(concurrent metabolic alkalosis or chronic respiratory acidosis)'}`]);
      }
      return {
        value: `${r1(eff)}`, unit: 'mmol/L', tier: eff > 12 ? 'high' : 'low', lines,
        summary: eff > 12 ? 'Elevated anion gap (>12).' : 'Anion gap not elevated.',
        note: v.albumin == null ? 'Add albumin to correct for hypoalbuminemia. Reference range is lab-specific.' : 'Reference range is lab-specific.',
      };
    },
  },
  {
    id: 'corrca', name: 'Corrected Calcium', cat: 'lytes',
    about: 'Total calcium adjusted for albumin.',
    needs: ['calcium', 'albumin'],
    compute(v) {
      const c = v.calcium + 0.02 * (40 - v.albumin);
      return {
        value: `${r2(c)}`, unit: 'mmol/L', tier: c > 2.6 ? 'high' : c < 2.1 ? 'mod' : 'low',
        summary: c > 2.6 ? 'Above the usual range (2.10–2.60).' : c < 2.1 ? 'Below the usual range (2.10–2.60).' : 'Within the usual range (2.10–2.60).',
        note: 'Ionized calcium is more reliable, especially in CKD and critical illness.',
      };
    },
  },
  {
    id: 'corrna', name: 'Sodium Corrected for Glucose', cat: 'lytes',
    about: 'Sodium adjusted for hyperglycemia.',
    needs: ['na', 'glucose'],
    compute(v) {
      const ex = Math.max(0, v.glucose - 5.6) / 5.6;
      const hill = v.na + 2.4 * ex, katz = v.na + 1.6 * ex;
      return {
        value: `${Math.round(hill)}`, unit: 'mmol/L', tier: 'info',
        summary: v.glucose <= 5.6 ? 'Glucose not elevated. No correction applied.' : 'Corrected with the Hillier factor (2.4 per 5.6 mmol/L of glucose).',
        lines: [['Hillier (2.4)', `${r1(hill)} mmol/L`], ['Katz (1.6)', `${r1(katz)} mmol/L`]],
      };
    },
  },
  {
    id: 'osm', name: 'Serum Osmolality', cat: 'acidbase',
    about: 'Calculated osmolality and osmolar gap.',
    needs: ['na', 'glucose', 'urea'], optional: ['measOsm'],
    compute(v) {
      const o = 2 * v.na + v.glucose + v.urea;
      const lines = [['Calculated', `${Math.round(o)} mOsm/kg`]];
      let tier = 'info', summary = 'Calculated as 2 × Na + glucose + urea.';
      if (v.measOsm != null) {
        const gap = v.measOsm - o;
        lines.push(['Osmolar gap', `${Math.round(gap)} mOsm/kg`]);
        tier = gap > 10 ? 'high' : 'low';
        summary = gap > 10 ? 'Elevated osmolar gap (>10). Consider toxic alcohols.' : 'Osmolar gap not elevated.';
      }
      return {
        value: `${Math.round(o)}`, unit: 'mOsm/kg', tier, summary, lines,
        note: v.measOsm == null ? 'Add measured osmolality for the osmolar gap.' : 'Ethanol, if present, adds to the gap.',
      };
    },
  },
  // ------------------------------------------------------------ Kidney (new)
  {
    id: 'ckdstage', name: 'CKD Staging (KDIGO)', cat: 'kidney',
    about: 'GFR and albuminuria categories with KDIGO risk level.',
    needs: ['cr', 'age', 'sex', 'acr'],
    compute(v) {
      const e = egfr(v), g = gCat(e), a = aCat(v.acr);
      const gi = ['G1', 'G2', 'G3a', 'G3b', 'G4', 'G5'].indexOf(g), ai = ['A1', 'A2', 'A3'].indexOf(a);
      // KDIGO heat map: 0 low, 1 moderate, 2 high, 3 very high
      const grid = [[0, 1, 2], [0, 1, 2], [1, 2, 3], [2, 3, 3], [3, 3, 3], [3, 3, 3]];
      const risk = grid[gi][ai];
      const label = ['Low risk', 'Moderately increased risk', 'High risk', 'Very high risk'][risk];
      return {
        value: `${g} ${a}`, tier: ['low', 'mod', 'high', 'high'][risk], summary: label + ' (KDIGO heat map).',
        lines: [['eGFR (CKD-EPI 2021)', `${Math.round(e)} mL/min/1.73 m²`], ['ACR', `${r1(v.acr)} mg/mmol`]],
        note: 'CKD requires abnormalities present for more than 3 months. A1 <3, A2 3–30, A3 >30 mg/mmol.',
      };
    },
  },
  ...[4, 8].map(nv => ({
    id: `kfre${nv}`, name: `Kidney Failure Risk Equation (${nv}-variable)`, cat: 'kidney',
    about: nv === 4 ? '2- and 5-year risk of kidney failure: age, sex, eGFR, ACR.'
      : '2- and 5-year risk of kidney failure, extended model with albumin, phosphate, bicarbonate and calcium.',
    needs: nv === 4 ? ['age', 'sex', 'cr', 'acr'] : ['age', 'sex', 'cr', 'acr', 'albumin', 'phos', 'hco3', 'calcium'],
    compute(v) {
      const e = egfr(v), acrMgG = v.acr * 8.84, male = v.sex === 'M' ? 1 : 0;
      let lp, s2, s5;
      if (nv === 4) {
        lp = -0.2201 * (v.age / 10 - 7.036) + 0.2467 * (male - 0.5642) - 0.5567 * (e / 5 - 7.222) + 0.4510 * (Math.log(acrMgG) - 5.137);
        s2 = 0.9832; s5 = 0.9365;
      } else {
        lp = -0.1992 * (v.age / 10 - 7.036) + 0.1602 * (male - 0.5642) - 0.4919 * (e / 5 - 7.222) + 0.3364 * (Math.log(acrMgG) - 5.137)
          - 0.3441 * (v.albumin / 10 - 3.997) + 0.2604 * (v.phos * 3.097 - 3.916) - 0.07354 * (v.hco3 - 25.57) - 0.2228 * (v.calcium * 4.008 - 9.355);
        s2 = 0.9780; s5 = 0.9301;
      }
      const p2 = 100 * (1 - Math.pow(s2, Math.exp(lp))), p5 = 100 * (1 - Math.pow(s5, Math.exp(lp)));
      const tier = p5 < 3 ? 'low' : p5 < 15 && p2 < 40 ? 'mod' : 'high';
      const summary = p2 >= 40 ? '2-year risk ≥40%: plan for kidney replacement therapy (access, transplant).'
        : p5 >= 5 ? '5-year risk ≥5%: nephrology referral is generally recommended.'
          : p5 >= 3 ? '5-year risk 3–5%: consider nephrology referral.' : '5-year risk <3%.';
      return {
        value: `${r1(p5)}%`, tier, summary,
        lines: [['2-year risk', `${r1(p2)}%`], ['5-year risk', `${r1(p5)}%`], ['eGFR used (CKD-EPI 2021)', `${Math.round(e)} mL/min/1.73 m²`]],
        note: 'North American calibration. Validated for CKD G3–G5 (eGFR <60) with stable kidney function.' + (e >= 60 ? ' eGFR is ≥60, so this estimate is outside the validated range.' : ''),
      };
    },
  })),
  {
    id: 'fena', name: 'Fractional Excretion of Sodium (FENa)', cat: 'kidney',
    about: 'Prerenal vs intrinsic AKI when not on diuretics.',
    needs: ['una', 'cr', 'na', 'ucr'],
    compute(v) {
      const f = 100 * (v.una * v.cr) / (v.na * v.ucr * 1000);
      return {
        value: `${r2(f)}%`, tier: f < 1 ? 'info' : 'info',
        summary: f < 1 ? 'FENa <1%: suggests a prerenal cause.' : f > 2 ? 'FENa >2%: suggests intrinsic injury such as ATN.' : 'FENa 1–2%: indeterminate.',
        note: 'Unreliable on diuretics (use FEurea), in CKD, and in contrast nephropathy, myoglobinuria and early obstruction, which can give a low FENa.',
      };
    },
  },
  {
    id: 'feurea', name: 'Fractional Excretion of Urea (FEurea)', cat: 'kidney',
    about: 'Prerenal vs intrinsic AKI, usable on diuretics.',
    needs: ['uurea', 'cr', 'urea', 'ucr'],
    compute(v) {
      const f = 100 * (v.uurea * v.cr) / (v.urea * v.ucr * 1000);
      return {
        value: `${r1(f)}%`, tier: 'info',
        summary: f <= 35 ? 'FEurea ≤35%: suggests a prerenal cause.' : f >= 50 ? 'FEurea ≥50%: suggests intrinsic injury such as ATN.' : 'FEurea 35–50%: indeterminate.',
      };
    },
  },
  {
    id: 'ureacr', name: 'Urea:Creatinine Ratio (BUN:Cr)', cat: 'kidney',
    about: 'Urea to creatinine ratio in SI units, with the BUN:Cr equivalent.',
    needs: ['urea', 'cr'],
    compute(v) {
      const si = 1000 * v.urea / v.cr, bun = ureaToBun(v.urea) / crMg(v.cr);
      return {
        value: `${Math.round(bun)}`, tier: 'info',
        summary: bun > 20 ? 'BUN:Cr >20: favours prerenal AKI or upper GI bleeding.' : bun < 10 ? 'BUN:Cr <10: favours intrinsic AKI or low urea production.' : 'BUN:Cr 10–20: non-specific.',
        lines: [['BUN:Cr (mg/dL basis)', `${r1(bun)}`], ['Urea (mmol/L) : creatinine (mmol/L)', `${Math.round(si)}`]],
        note: 'SI ratio >100 corresponds roughly to BUN:Cr >25. Raised by steroids, catabolism and GI bleeding.',
      };
    },
  },
  {
    id: 'ain', name: 'AIN Risk Calculator (Moledina)', cat: 'kidney',
    about: 'Probability of acute interstitial nephritis in AKI being considered for biopsy.',
    needs: ['cr', 'urea', 'usg', 'uprotHigh', 'ainPrev'],
    compute(v) {
      const crmg = crMg(v.cr), ratio = ureaToBun(v.urea) / crmg;
      const sum = 0.8367518 * Math.log(crmg) - 0.9181938 * Math.log(ratio) - 0.0501203 * 1000 * (v.usg - 1)
        + (v.uprotHigh ? 0 : 0.9360127) + Math.log((v.ainPrev / 100) / 0.23) + 0.770398;
      const p = 100 * Math.exp(sum) / (1 + Math.exp(sum));
      return {
        value: `${Math.round(p)}%`, tier: p < 20 ? 'low' : p < 50 ? 'mod' : 'high',
        summary: p < 20 ? 'Low probability of AIN (<20%).' : p < 50 ? 'Intermediate probability of AIN (20–50%).' : 'High probability of AIN (≥50%).',
        lines: [['Creatinine', `${r2(crmg)} mg/dL`], ['BUN:Cr ratio', `${r1(ratio)}`]],
        note: 'Supports, not replaces, the decision to biopsy. Derived in biopsied patients; exclude known lupus nephritis or vasculitis.',
      };
    },
  },
  {
    id: 'atnisi', name: 'ATN Individual Severity Index (Liaño)', cat: 'kidney',
    about: 'Mortality estimate in acute tubular necrosis.',
    needs: ['age', 'sex', 'nephrotoxic', 'oliguria', 'atnHypotension', 'bili', 'coma', 'ams', 'mechVent'],
    compute(v) {
      const jaundice = v.bili > 34;
      const parts = [
        ['Age (per decade)', 0.032 * Math.round(v.age / 10)],
        ['Male sex', v.sex === 'M' ? -0.086 : 0], ['Nephrotoxic cause', v.nephrotoxic ? -0.109 : 0],
        ['Oliguria', v.oliguria ? 0.109 : 0], ['Hypotension', v.atnHypotension ? 0.116 : 0],
        ['Jaundice (bilirubin >34 µmol/L)', jaundice ? 0.122 : 0], ['Coma', v.coma ? 0.150 : 0],
        ['Normal consciousness', !v.ams && !v.coma ? -0.154 : 0], ['Assisted ventilation', v.mechVent ? 0.182 : 0],
        ['Constant', 0.21],
      ];
      const isi = clamp(sum(parts), 0, 1), m = Math.round(isi * 100 + 1e-9);
      return {
        value: `${m}%`, tier: isi < 0.3 ? 'low' : isi < 0.6 ? 'mod' : 'high',
        summary: `Predicted mortality about ${m}% (index ${r2(isi)}).`, parts,
        note: 'Linear model (Liaño 1993). Normal consciousness uses the shared "altered mental status" answer.',
      };
    },
  },
  {
    id: 'sharf', name: 'SHARF II Score (at diagnosis)', cat: 'kidney',
    about: 'Hospital mortality in acute kidney injury, Stuivenberg score at diagnosis (T0).',
    needs: ['age', 'albumin', 'ptPct', 'mechVent', 'chf', 'bili', 'sepsis', 'sharfHypotension'],
    compute(v) {
      const dec = Math.floor(v.age / 10);
      const a = v.albumin, albCat = a > 45 ? 1 : a >= 41 ? 2 : a >= 36 ? 3 : a >= 31 ? 4 : a >= 26 ? 5 : a >= 21 ? 6 : 7;
      const biliMgDl = biliMg(v.bili);
      const parts = [
        ['Age decade × 3.0', 3.0 * dec], ['Albumin category × 2.6', 2.6 * albCat],
        ['Prothrombin category × 1.3', 1.3 * +v.ptPct], ['Respiratory support', v.mechVent ? 16.8 : 0],
        ['Heart failure', v.chf ? 3.9 : 0], ['Bilirubin (mg/dL) × 2.8', 2.8 * biliMgDl],
        ['Sepsis', v.sepsis ? 27 : 0], ['Hypotension', v.sharfHypotension ? 21 : 0], ['Constant', -17],
      ];
      const sc = sum(parts), m = clamp(sc, 0, 100);
      return {
        value: `${Math.round(sc)}`, tier: m < 30 ? 'low' : m < 60 ? 'mod' : 'high',
        summary: `Predicted hospital mortality about ${Math.round(m)}%.`, parts,
        note: 'SHARF II at diagnosis (Lins 2004, ICU AKI cohort). Uses prothrombin activity in %, not INR. Bilirubin entered as mg/dL in the original; converted here from µmol/L.',
      };
    },
  },
  {
    id: 'mehran', name: 'Mehran Score (contrast nephropathy)', cat: 'kidney',
    about: 'Risk of contrast-induced nephropathy and dialysis after PCI.',
    needs: ['mehHypotension', 'iabp', 'chfSevere', 'age', 'anemiaHct', 'diabetes', 'contrast', 'cr', 'sex'],
    compute(v) {
      const e = egfr(v);
      const gfrPts = e < 20 ? 6 : e < 40 ? 4 : e < 60 ? 2 : 0;
      const crPts = crMg(v.cr) > 1.5 ? 4 : 0;
      const parts = [
        ['Hypotension', v.mehHypotension ? 5 : 0], ['IABP', v.iabp ? 5 : 0], ['Heart failure', v.chfSevere ? 5 : 0],
        ['Age >75', v.age > 75 ? 4 : 0], ['Anemia', v.anemiaHct ? 3 : 0], ['Diabetes', v.diabetes ? 3 : 0],
        ['Contrast (1 per 100 mL)', Math.floor(v.contrast / 100)], [`eGFR ${Math.round(e)}`, gfrPts],
      ];
      const t = sum(parts);
      const band = t <= 5 ? ['7.5%', '0.04%'] : t <= 10 ? ['14.0%', '0.12%'] : t <= 15 ? ['26.1%', '1.09%'] : ['57.3%', '12.6%'];
      const alt = t - gfrPts + crPts;
      return {
        value: pts(t), tier: t <= 5 ? 'low' : t <= 10 ? 'mod' : 'high', parts,
        summary: `Contrast nephropathy risk ${band[0]}; dialysis risk ${band[1]}.`,
        lines: [['Creatinine version (Cr >1.5 mg/dL = 4)', pts(alt)]],
        note: 'eGFR version shown, using CKD-EPI 2021 (the original used MDRD). Contrast counted per full 100 mL.',
      };
    },
  },
  {
    id: 'mcmahon', name: 'McMahon Score (rhabdomyolysis)', cat: 'kidney',
    about: 'Risk of kidney replacement therapy or death in rhabdomyolysis.',
    needs: ['age', 'sex', 'cr', 'calcium', 'ck', 'rhabdoOtherCause', 'phos', 'hco3'],
    compute(v) {
      const parts = [
        ['Age', v.age > 80 ? 3 : v.age > 70 ? 2.5 : v.age > 50 ? 1.5 : 0],
        ['Female sex', v.sex === 'F' ? 1 : 0],
        ['Creatinine', v.cr > 194 ? 3 : v.cr >= 124 ? 1.5 : 0],
        ['Calcium <1.88 mmol/L', v.calcium < 1.88 ? 2 : 0],
        ['CK >40,000 U/L', v.ck > 40000 ? 2 : 0],
        ['Higher-risk cause', v.rhabdoOtherCause ? 3 : 0],
        ['Phosphate', v.phos > 1.74 ? 3 : v.phos >= 1.29 ? 1.5 : 0],
        ['Bicarbonate <19 mmol/L', v.hco3 < 19 ? 2 : 0],
      ];
      const t = sum(parts);
      return {
        value: `${t} points`, tier: t < 6 ? 'low' : 'high', parts,
        summary: t < 6 ? 'Score <6: low risk (about 3%) of kidney replacement therapy or death.' : 'Score ≥6: not low risk. Consider aggressive fluids and close monitoring.',
        note: 'Use initial (admission) values. Total calcium uncorrected.',
      };
    },
  },

  // ------------------------------------------------------------ Acid–base (new)
  {
    id: 'deltagap', name: 'Delta Gap and Delta Ratio', cat: 'acidbase',
    about: 'Detects a second metabolic disorder alongside a high anion gap acidosis.',
    needs: ['na', 'cl', 'hco3'], optional: ['albumin'],
    compute(v) {
      let ag = v.na - v.cl - v.hco3;
      if (v.albumin != null) ag += 0.25 * (40 - v.albumin);
      const dg = ag - 12, dHco3 = 24 - v.hco3, ratio = dHco3 > 0 ? dg / dHco3 : null;
      const corrHco3 = v.hco3 + dg;
      let summary;
      if (ag <= 12) summary = 'Anion gap not elevated, so the delta gap does not apply.';
      else if (ratio === null) summary = 'Bicarbonate is not low: a high gap with normal or high bicarbonate implies a concurrent metabolic alkalosis.';
      else summary = ratio < 0.4 ? 'Ratio <0.4: hyperchloremic (non-gap) acidosis.'
        : ratio < 1 ? 'Ratio 0.4–1: combined gap and non-gap acidosis.'
          : ratio <= 2 ? 'Ratio 1–2: pure anion gap acidosis.' : 'Ratio >2: concurrent metabolic alkalosis or pre-existing high bicarbonate.';
      return {
        value: ratio === null ? '–' : `${r2(ratio)}`, tier: 'info', summary,
        lines: [[v.albumin != null ? 'Anion gap (albumin-corrected)' : 'Anion gap', `${r1(ag)} mmol/L`],
          ['Delta gap (AG − 12)', `${r1(dg)} mmol/L`], ['Corrected bicarbonate (HCO3 + delta gap)', `${r1(corrHco3)} mmol/L`]],
        note: 'Assumes a normal anion gap of 12. Corrected bicarbonate >26 suggests metabolic alkalosis, <22 a non-gap acidosis.',
      };
    },
  },
  {
    id: 'winters', name: "Winters' Formula", cat: 'acidbase',
    about: 'Expected pCO2 in metabolic acidosis.',
    needs: ['hco3'], optional: ['pco2'],
    compute(v) {
      const exp = 1.5 * v.hco3 + 8;
      const lines = [['Expected pCO2', `${r1(exp - 2)}–${r1(exp + 2)} mmHg`]];
      let summary = `Expected pCO2 ${r1(exp)} ± 2 mmHg.`, tier = 'info';
      if (v.pco2 != null) {
        lines.push(['Measured pCO2', `${r1(v.pco2)} mmHg`]);
        summary = v.pco2 > exp + 2 ? 'pCO2 higher than expected: concurrent respiratory acidosis.'
          : v.pco2 < exp - 2 ? 'pCO2 lower than expected: concurrent respiratory alkalosis.' : 'Appropriate respiratory compensation.';
        tier = v.pco2 > exp + 2 || v.pco2 < exp - 2 ? 'mod' : 'low';
      }
      return { value: `${r1(exp)}`, unit: 'mmHg', tier, summary, lines, note: 'Valid for metabolic acidosis only.' };
    },
  },
  {
    id: 'abg', name: 'Acid–Base Compensation', cat: 'acidbase',
    about: 'Primary disorder and expected compensation for metabolic and respiratory acidosis and alkalosis.',
    needs: ['ph', 'pco2', 'hco3'],
    compute(v) {
      const { ph, pco2: p, hco3: h } = v;
      const lines = [];
      let primary, expected = '', verdict = '', tier = 'info';
      const judge = (lo, hi, measured, unit, highMsg, lowMsg) => {
        lines.push(['Expected ' + unit, `${r1(lo)}–${r1(hi)}`], ['Measured ' + unit, `${r1(measured)}`]);
        if (measured > hi) { tier = 'mod'; return highMsg; }
        if (measured < lo) { tier = 'mod'; return lowMsg; }
        tier = 'low'; return 'Compensation is appropriate.';
      };
      if (ph < 7.35) {
        if (h < 22 && p > 45) { primary = 'Mixed metabolic and respiratory acidosis'; tier = 'high'; }
        else if (h < 22) {
          primary = 'Metabolic acidosis';
          const e = 1.5 * h + 8;
          verdict = judge(e - 2, e + 2, p, 'pCO2 (mmHg)', 'pCO2 higher than expected: concurrent respiratory acidosis.', 'pCO2 lower than expected: concurrent respiratory alkalosis.');
        } else if (p > 45) {
          primary = 'Respiratory acidosis';
          const acute = 24 + 0.1 * (p - 40), chronic = 24 + 0.35 * (p - 40);
          lines.push(['Expected HCO3 if acute', `${r1(acute)} mmol/L`], ['Expected HCO3 if chronic', `${r1(chronic)} mmol/L`], ['Measured HCO3', `${r1(h)} mmol/L`]);
          verdict = h < acute - 2 ? 'HCO3 lower than expected even for acute: concurrent metabolic acidosis.'
            : h > chronic + 2 ? 'HCO3 higher than expected even for chronic: concurrent metabolic alkalosis.'
              : h <= (acute + chronic) / 2 ? 'Consistent with acute (or acute-on-chronic) respiratory acidosis.' : 'Consistent with chronic respiratory acidosis.';
          tier = /concurrent/.test(verdict) ? 'mod' : 'low';
        } else primary = 'Acidemia without a clear primary disorder. Check the values.';
      } else if (ph > 7.45) {
        if (h > 26 && p < 35) { primary = 'Mixed metabolic and respiratory alkalosis'; tier = 'high'; }
        else if (h > 26) {
          primary = 'Metabolic alkalosis';
          const e = 0.7 * (h - 24) + 40;
          verdict = judge(e - 5, e + 5, p, 'pCO2 (mmHg)', 'pCO2 higher than expected: concurrent respiratory acidosis.', 'pCO2 lower than expected: concurrent respiratory alkalosis.');
        } else if (p < 35) {
          primary = 'Respiratory alkalosis';
          const acute = 24 - 0.2 * (40 - p), chronic = 24 - 0.4 * (40 - p);
          lines.push(['Expected HCO3 if acute', `${r1(acute)} mmol/L`], ['Expected HCO3 if chronic', `${r1(chronic)} mmol/L`], ['Measured HCO3', `${r1(h)} mmol/L`]);
          verdict = h > acute + 2 ? 'HCO3 higher than expected even for acute: concurrent metabolic alkalosis.'
            : h < chronic - 2 ? 'HCO3 lower than expected even for chronic: concurrent metabolic acidosis.'
              : h >= (acute + chronic) / 2 ? 'Consistent with acute respiratory alkalosis.' : 'Consistent with chronic respiratory alkalosis.';
          tier = /concurrent/.test(verdict) ? 'mod' : 'low';
        } else primary = 'Alkalemia without a clear primary disorder. Check the values.';
      } else {
        if (h < 22 && p < 35) { primary = 'Normal pH with low HCO3 and low pCO2: mixed metabolic acidosis and respiratory alkalosis'; tier = 'mod'; }
        else if (h > 26 && p > 45) { primary = 'Normal pH with high HCO3 and high pCO2: mixed metabolic alkalosis and respiratory acidosis'; tier = 'mod'; }
        else { primary = 'No primary acid–base disorder on these values'; tier = 'low'; }
      }
      return {
        value: primary.split(':')[0].replace('Normal pH with low HCO3 and low pCO2', 'Mixed disorder').replace('Normal pH with high HCO3 and high pCO2', 'Mixed disorder'),
        tier, summary: verdict || primary, lines,
        note: 'Rules: metabolic acidosis pCO2 = 1.5 × HCO3 + 8 ± 2; metabolic alkalosis pCO2 = 40 + 0.7 × ΔHCO3 ± 5; respiratory acidosis HCO3 +1 (acute) or +3.5 (chronic) per 10 mmHg; respiratory alkalosis HCO3 −2 (acute) or −4 (chronic) per 10 mmHg. Always check the anion gap.',
      };
    },
  },
  {
    id: 'uag', name: 'Urine Anion Gap', cat: 'acidbase',
    about: 'Renal vs extrarenal cause of a normal anion gap metabolic acidosis.',
    needs: ['una', 'uk', 'ucl'],
    compute(v) {
      const g = v.una + v.uk - v.ucl;
      return {
        value: `${Math.round(g)}`, unit: 'mmol/L', tier: 'info',
        summary: g < 0 ? 'Negative: appropriate ammonium excretion, suggests GI bicarbonate loss (e.g. diarrhea).' : 'Positive: low ammonium excretion, suggests renal tubular acidosis.',
        note: 'Unreliable with urine sodium <20 mmol/L, ketonuria or other unmeasured anions; consider the urine osmolal gap.',
      };
    },
  },

  // ------------------------------------------------------------ Resp / cardio (new)
  {
    id: 'pf', name: 'PaO2/FiO2 Ratio', cat: 'resp',
    about: 'Oxygenation, with Berlin ARDS severity bands.',
    needs: ['pao2', 'fio2'],
    compute(v) {
      const r = v.pao2 / (v.fio2 / 100);
      return {
        value: `${Math.round(r)}`, unit: 'mmHg', tier: r > 300 ? 'low' : r > 200 ? 'mod' : 'high',
        summary: r > 300 ? 'Above 300: not in the ARDS range.' : r > 200 ? '200–300: mild ARDS range.' : r > 100 ? '100–200: moderate ARDS range.' : '≤100: severe ARDS range.',
        note: 'Berlin bands apply with PEEP or CPAP ≥5 cmH2O and the other ARDS criteria.',
      };
    },
  },
  {
    id: 'map', name: 'Mean Arterial Pressure', cat: 'cardio',
    about: 'MAP from systolic and diastolic pressure.',
    needs: ['sbp', 'dbp'],
    compute(v) {
      const m = v.dbp + (v.sbp - v.dbp) / 3;
      return {
        value: `${Math.round(m)}`, unit: 'mmHg', tier: m < 65 ? 'high' : 'low',
        summary: m < 65 ? 'Below 65 mmHg, the usual target in shock.' : 'At or above 65 mmHg.',
      };
    },
  },

  // ------------------------------------------------------------ Electrolytes and fluids (new)
  {
    id: 'fwd', name: 'Free Water Deficit', cat: 'lytes',
    about: 'Water deficit in hypernatremia.',
    needs: ['na', 'weight', 'age', 'sex'],
    compute(v) {
      const tbw = tbwFraction(v) * v.weight, d = tbw * (v.na / 140 - 1);
      return {
        value: d > 0 ? `${r1(d)}` : '0', unit: 'L', tier: 'info',
        summary: d > 0 ? `Replace over 48–72 h (about ${Math.round(1000 * d / 48)} mL/h over 48 h), plus ongoing losses.` : 'Sodium is not above 140; no free water deficit.',
        lines: [['Total body water', `${r1(tbw)} L (${tbwFraction(v)} × weight)`]],
        note: 'Aim to lower sodium by no more than 10–12 mmol/L per 24 h in chronic hypernatremia. Recheck sodium often.',
      };
    },
  },
  {
    id: 'nadef', name: 'Sodium Deficit (hyponatremia)', cat: 'lytes',
    about: 'Sodium deficit, and the expected change per litre of common fluids (Adrogué-Madias).',
    needs: ['na', 'weight', 'age', 'sex'], optional: ['naTarget'],
    compute(v) {
      const tbw = tbwFraction(v) * v.weight;
      const target = v.naTarget != null ? v.naTarget : v.na + 8;
      const def = tbw * (target - v.na);
      const per = inf => (inf - v.na) / (tbw + 1);
      return {
        value: `${Math.round(def)}`, unit: 'mmol', tier: 'info',
        summary: `Sodium needed to reach ${target} mmol/L${v.naTarget == null ? ' (current + 8, the usual 24-hour limit)' : ''}.`,
        lines: [
          ['3% saline: change per 1 L', `${r1(per(513))} mmol/L`],
          ['0.9% saline: change per 1 L', `${r1(per(154))} mmol/L`],
          ['Ringer\'s lactate: change per 1 L', `${r1(per(130))} mmol/L`],
          ['Total body water', `${r1(tbw)} L`],
        ],
        note: 'Limit correction to 8 mmol/L in 24 h when the risk of osmotic demyelination is high (10–12 otherwise). Formulas ignore ongoing losses and water diuresis; recheck sodium every 2–4 h.',
      };
    },
  },
  {
    id: 'maint', name: 'Maintenance IV Fluids', cat: 'lytes',
    about: 'Maintenance fluid rate by the 4-2-1 rule and by weight.',
    needs: ['weight'],
    compute(v) {
      const w = v.weight;
      const rate = w <= 10 ? 4 * w : w <= 20 ? 40 + 2 * (w - 10) : 60 + (w - 20);
      return {
        value: `${Math.round(rate)}`, unit: 'mL/h', tier: 'info', summary: 'Holliday-Segar 4-2-1 rule.',
        lines: [['4-2-1 rule', `${Math.round(rate)} mL/h (${Math.round(rate * 24)} mL/day)`],
          ['25–30 mL/kg/day', `${Math.round(25 * w)}–${Math.round(30 * w)} mL/day (${Math.round(25 * w / 24)}–${Math.round(30 * w / 24)} mL/h)`],
          ['Potassium, sodium, chloride', 'About 1 mmol/kg/day each'], ['Glucose', '50–100 g/day']],
        note: 'Use less in heart failure, kidney failure, frailty or obesity (consider ideal weight). Reassess daily.',
      };
    },
  },

  // ------------------------------------------------------------ Body weight (new)
  {
    id: 'ibw', name: 'Ideal Body Weight (Devine)', cat: 'body',
    about: 'Ideal body weight from height and sex.',
    needs: ['height', 'sex'],
    compute(v) {
      const w = ibwKg(v);
      return {
        value: `${r1(w)}`, unit: 'kg', tier: 'info', summary: v.sex === 'F' ? '45.5 kg + 2.3 kg per inch over 5 feet.' : '50 kg + 2.3 kg per inch over 5 feet.',
        note: v.height < 152.4 ? 'Height is under 5 feet; the formula is less reliable here.' : 'Used for tidal volume (6 mL/kg IBW) and some drug dosing.',
        lines: [['Tidal volume 6 mL/kg', `${Math.round(6 * w)} mL`], ['Tidal volume 8 mL/kg', `${Math.round(8 * w)} mL`]],
      };
    },
  },
  {
    id: 'adjbw', name: 'Adjusted Body Weight', cat: 'body',
    about: 'Dosing weight in obesity: IBW + 0.4 × (actual − IBW).',
    needs: ['height', 'sex', 'weight'],
    compute(v) {
      const ibw = ibwKg(v), adj = ibw + 0.4 * (v.weight - ibw), pctIbw = 100 * v.weight / ibw;
      const bmi = v.weight / Math.pow(v.height / 100, 2);
      return {
        value: `${r1(adj)}`, unit: 'kg', tier: 'info',
        summary: pctIbw > 120 ? `Actual weight is ${Math.round(pctIbw)}% of IBW, so adjusted weight is usually used.` : `Actual weight is ${Math.round(pctIbw)}% of IBW; adjusted weight is usually not needed (<120%).`,
        lines: [['Ideal body weight', `${r1(ibw)} kg`], ['Actual weight', `${r1(v.weight)} kg`], ['BMI', `${r1(bmi)} kg/m²`]],
      };
    },
  },

  // ------------------------------------------------------------ Rheumatology (new)
  {
    id: 'gcaps', name: 'GCA Probability Score (GCAPS)', cat: 'rheum',
    about: 'Pretest probability of giant cell arteritis (Southend score).',
    needs: ['age', 'sex', 'gcaOnset', 'crp', 'gcaHeadache', 'gcaConst', 'gcaPmr', 'gcaIschaemic', 'gcaVisualSigns', 'gcaTa', 'gcaExtra', 'gcaCnPalsy', 'gcaAltDx'],
    compute(v) {
      const parts = [
        ['Age', v.age >= 66 ? 3 : v.age >= 61 ? 2 : v.age >= 50 ? 1 : 0],
        ['Sex', v.sex === 'F' ? 2 : 1],
        ['Symptom onset', +v.gcaOnset],
        ['CRP', v.crp >= 25 ? 3 : v.crp > 10 ? 2 : v.crp > 5 ? 1 : 0],
        ['Headache', v.gcaHeadache ? 1 : 0], ['Constitutional', +v.gcaConst], ['Polymyalgic', v.gcaPmr ? 2 : 0],
        ['Ischaemic symptoms', v.gcaIschaemic ? 3 : 0], ['Visual signs', v.gcaVisualSigns ? 3 : 0],
        ['Temporal artery', +v.gcaTa], ['Extracranial artery', +v.gcaExtra], ['Cranial nerve palsy', v.gcaCnPalsy ? 3 : 0],
        ['Other likely cause', v.gcaAltDx ? -3 : 0],
      ];
      const t = sum(parts);
      return {
        value: pts(t), tier: t < 9 ? 'low' : t <= 12 ? 'mod' : 'high', parts,
        summary: t < 9 ? 'Low risk (<9).' : t <= 12 ? 'Intermediate risk (9–12). Urgent assessment and imaging.' : 'High risk (>12). Treat as GCA pending confirmation.',
        note: 'Laskou 2019; risk bands from Sebastian 2020 fast-track pathway. Supports, not replaces, ultrasound or biopsy.',
      };
    },
  },

];

export const SCORE = Object.fromEntries(SCORES.map(s => [s.id, s]));
