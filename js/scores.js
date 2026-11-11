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

export const CATEGORIES = [
  { id: 'cardio', label: 'Cardiology' },
  { id: 'vte', label: 'Thrombosis' },
  { id: 'resp', label: 'Respirology and sepsis' },
  { id: 'gi', label: 'GI and hepatology' },
  { id: 'renal', label: 'Nephrology and electrolytes' },
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
    id: 'ckdepi', name: 'eGFR (CKD-EPI 2021)', cat: 'renal',
    about: 'Estimated GFR from creatinine, race-free equation.',
    needs: ['cr', 'age', 'sex'],
    compute(v) {
      const f = v.sex === 'F', k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302, s = crMg(v.cr) / k;
      const e = 142 * Math.pow(Math.min(s, 1), a) * Math.pow(Math.max(s, 1), -1.2) * Math.pow(0.9938, v.age) * (f ? 1.012 : 1);
      const g = e >= 90 ? 'G1' : e >= 60 ? 'G2' : e >= 45 ? 'G3a' : e >= 30 ? 'G3b' : e >= 15 ? 'G4' : 'G5';
      return {
        value: `${Math.round(e)}`, unit: 'mL/min/1.73 m²', tier: e >= 60 ? 'low' : e >= 30 ? 'mod' : 'high',
        summary: `GFR category ${g}.`, note: 'Assumes steady-state creatinine. Not valid in AKI.',
      };
    },
  },
  {
    id: 'cg', name: 'Creatinine Clearance (Cockcroft-Gault)', cat: 'renal',
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
    id: 'ag', name: 'Anion Gap', cat: 'renal',
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
    id: 'corrca', name: 'Corrected Calcium', cat: 'renal',
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
    id: 'corrna', name: 'Sodium Corrected for Glucose', cat: 'renal',
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
    id: 'osm', name: 'Serum Osmolality', cat: 'renal',
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
];

export const SCORE = Object.fromEntries(SCORES.map(s => [s.id, s]));
