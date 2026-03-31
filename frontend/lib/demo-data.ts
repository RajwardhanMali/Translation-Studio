import type { Segment, ValidationResult, GlossaryTerm } from './api'

export const DEMO_DOCUMENT_ID = 'demo-doc-001'

export const DEMO_SEGMENTS: Segment[] = [
  {
    segment_id: 'seg-001',
    source_text: 'Welcome to our annual financial report for the fiscal year 2024.',
    translated_text: 'Bienvenue dans notre rapport financier annuel pour l\'exercice 2024.',
    final_text: 'Bienvenue dans notre rapport financier annuel pour l\'exercice 2024.',
    status: 'exact',
    type: 'sentence',
    tm_suggestions: [
      { text: 'Bienvenue dans notre rapport financier annuel pour l\'exercice 2024.', score: 100 },
    ],
    glossary_violations: [],
  },
  {
    segment_id: 'seg-002',
    source_text: 'Revenue increased by 18% compared to the previous fiscal year.',
    translated_text: 'Le chiffre d\'affaires a augmenté de 18% par rapport à l\'exercice précédent.',
    final_text: 'Le chiffre d\'affaires a augmenté de 18% par rapport à l\'exercice précédent.',
    status: 'fuzzy',
    type: 'sentence',
    tm_suggestions: [
      { text: 'Le revenu a augmenté de 18% par rapport à l\'année précédente.', score: 82 },
      { text: 'Les revenus ont progressé de 18% comparé à l\'exercice fiscal précédent.', score: 74 },
    ],
    glossary_violations: ['Revenue'],
  },
  {
    segment_id: 'seg-003',
    source_text: 'Our AI-driven supply chain optimization reduced operational costs by 12%.',
    translated_text: 'Notre optimisation de la chaîne d\'approvisionnement pilotée par l\'IA a réduit les coûts opérationnels de 12%.',
    final_text: '',
    status: 'new',
    type: 'sentence',
    tm_suggestions: [],
    glossary_violations: ['AI', 'supply chain'],
  },
  {
    segment_id: 'seg-004',
    source_text: 'The Board of Directors approved a dividend of $2.50 per share.',
    translated_text: 'Le Conseil d\'administration a approuvé un dividende de 2,50 $ par action.',
    final_text: 'Le Conseil d\'administration a approuvé un dividende de 2,50 $ par action.',
    status: 'exact',
    type: 'sentence',
    tm_suggestions: [
      { text: 'Le Conseil d\'administration a approuvé un dividende de 2,50 $ par action.', score: 100 },
    ],
    glossary_violations: [],
  },
  {
    segment_id: 'seg-005',
    source_text: 'Market expansion into Southeast Asia generated $45 million in new revenue streams.',
    translated_text: 'L\'expansion du marché en Asie du Sud-Est a généré 45 millions de dollars de nouveaux flux de revenus.',
    final_text: 'L\'expansion du marché en Asie du Sud-Est a généré 45 millions de dollars de nouveaux flux de revenus.',
    status: 'fuzzy',
    type: 'sentence',
    tm_suggestions: [
      { text: 'La pénétration du marché en Asie du Sud-Est a produit 45 millions USD de revenus supplémentaires.', score: 68 },
    ],
    glossary_violations: [],
  },
  {
    segment_id: 'seg-006',
    source_text: 'Sustainability initiatives resulted in a 30% reduction in carbon emissions.',
    translated_text: 'Les initiatives de développement durable ont permis une réduction de 30% des émissions de carbone.',
    final_text: '',
    status: 'new',
    type: 'sentence',
    tm_suggestions: [],
    glossary_violations: ['Sustainability'],
  },
  {
    segment_id: 'seg-007',
    source_text: 'Customer satisfaction scores reached an all-time high of 94 points.',
    translated_text: 'Les scores de satisfaction client ont atteint un niveau record de 94 points.',
    final_text: 'Les scores de satisfaction client ont atteint un niveau record de 94 points.',
    status: 'exact',
    type: 'sentence',
    tm_suggestions: [
      { text: 'Les scores de satisfaction client ont atteint un niveau record de 94 points.', score: 97 },
    ],
    glossary_violations: [],
  },
  {
    segment_id: 'seg-008',
    source_text: 'Research and development expenditure totalled $120 million, a 25% increase year-over-year.',
    translated_text: 'Les dépenses de recherche et développement ont totalisé 120 millions de dollars, soit une augmentation de 25% d\'une année sur l\'autre.',
    final_text: '',
    status: 'new',
    type: 'sentence',
    tm_suggestions: [
      { text: 'Les dépenses R&D se sont élevées à 120 millions USD, en hausse de 25% en glissement annuel.', score: 71 },
    ],
    glossary_violations: ['R&D'],
  },
]

export const DEMO_VALIDATION: ValidationResult[] = [
  {
    text: 'This document contians important informations about our company.',
    issues: [
      {
        issue_type: 'spelling',
        issue: '"contians" is misspelled',
        suggestion: 'Replace with "contains"',
        severity: 'error',
      },
      {
        issue_type: 'grammar',
        issue: '"informations" is not a countable noun in English',
        suggestion: 'Replace with "information"',
        severity: 'warning',
      },
    ],
    auto_fixed_text: 'This document contains important information about our company.',
    has_errors: true,
    has_warnings: true,
  },
  {
    text: 'The  revenue grew significantly  in Q3.',
    issues: [
      {
        issue_type: 'double_space',
        issue: 'Double space after "The" and after "significantly"',
        suggestion: 'Remove extra spaces',
        severity: 'warning',
      },
    ],
    auto_fixed_text: 'The revenue grew significantly in Q3.',
    has_errors: false,
    has_warnings: true,
  },
  {
    text: 'Our team of 5,000 employes work tirelessly to deliver excellence.',
    issues: [
      {
        issue_type: 'spelling',
        issue: '"employes" is misspelled',
        suggestion: 'Replace with "employees"',
        severity: 'error',
      },
    ],
    auto_fixed_text: 'Our team of 5,000 employees work tirelessly to deliver excellence.',
    has_errors: true,
    has_warnings: false,
  },
  {
    text: 'Our global footprint spans over 42 countries and six continents.',
    issues: [],
    auto_fixed_text: 'Our global footprint spans over 42 countries and six continents.',
    has_errors: false,
    has_warnings: false,
  },
  {
    text: 'The Board of Directors will conveen on March 15th to review quarterly results.',
    issues: [
      {
        issue_type: 'spelling',
        issue: '"conveen" is misspelled',
        suggestion: 'Replace with "convene"',
        severity: 'error',
      },
    ],
    auto_fixed_text: 'The Board of Directors will convene on March 15th to review quarterly results.',
    has_errors: true,
    has_warnings: false,
  },
]

export const DEMO_GLOSSARY: GlossaryTerm[] = [
  { id: '1', source: 'Revenue', target: 'Chiffre d\'affaires', language: 'fr', domain: 'Finance', notes: 'Preferred over "revenu" in financial contexts' },
  { id: '2', source: 'Board of Directors', target: 'Conseil d\'administration', language: 'fr', domain: 'Corporate', notes: 'Always capitalize' },
  { id: '3', source: 'Sustainability', target: 'Développement durable', language: 'fr', domain: 'ESG', notes: 'Use "développement durable" not "durabilité"' },
  { id: '4', source: 'AI', target: 'IA', language: 'fr', domain: 'Technology', notes: 'Acronym: Intelligence Artificielle' },
  { id: '5', source: 'supply chain', target: 'chaîne d\'approvisionnement', language: 'fr', domain: 'Operations', notes: 'Do not use "chaîne logistique"' },
  { id: '6', source: 'R&D', target: 'R&D', language: 'fr', domain: 'Finance', notes: 'Abbreviation unchanged; spell out as Recherche & Développement when first used' },
  { id: '7', source: 'dividend', target: 'dividende', language: 'fr', domain: 'Finance', notes: 'Always singular in French' },
  { id: '8', source: 'fiscal year', target: 'exercice fiscal', language: 'fr', domain: 'Finance', notes: 'Use "exercice" alone is also acceptable' },
]
