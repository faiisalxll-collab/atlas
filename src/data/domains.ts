import type { MacroDomainId } from './types';

export interface DomainMeta {
  id: MacroDomainId;
  labelEn: string;
  labelAr: string;
  colorHex: string;
  accentHex: string;
  defaultPos: [number, number, number];
}

export const MACRO_DOMAINS: Record<MacroDomainId, DomainMeta> = {
  Intelligence: {
    id: 'Intelligence',
    labelEn: 'Intelligence',
    labelAr: 'الذكاء والوكلاء',
    colorHex: '#F6F5F1',
    accentHex: '#C6B79B',
    defaultPos: [28, 12, 18],
  },
  Infrastructure: {
    id: 'Infrastructure',
    labelEn: 'Infrastructure',
    labelAr: 'البنية التحتية',
    colorHex: '#E5E7EB',
    accentHex: '#94A3B8',
    defaultPos: [-28, 14, 16],
  },
  Engineering: {
    id: 'Engineering',
    labelEn: 'Engineering',
    labelAr: 'هندسة البرمجيات',
    colorHex: '#D1D5DB',
    accentHex: '#A8A29E',
    defaultPos: [0, -28, 22],
  },
  Perception: {
    id: 'Perception',
    labelEn: 'Perception',
    labelAr: 'الإدراك والصوت',
    colorHex: '#E2E8F0',
    accentHex: '#CBD5E1',
    defaultPos: [32, -14, -18],
  },
  'Creative Systems': {
    id: 'Creative Systems',
    labelEn: 'Creative Systems',
    labelAr: 'الأنظمة الإبداعية',
    colorHex: '#F5F5F4',
    accentHex: '#D6D3D1',
    defaultPos: [-32, -16, -16],
  },
  Security: {
    id: 'Security',
    labelEn: 'Security',
    labelAr: 'الأمن السيبراني',
    colorHex: '#E7E5E4',
    accentHex: '#C6B79B',
    defaultPos: [16, 28, -24],
  },
  'Frontier Research': {
    id: 'Frontier Research',
    labelEn: 'Frontier Research',
    labelAr: 'أبحاث الطليعة',
    colorHex: '#F3F4F6',
    accentHex: '#9CA3AF',
    defaultPos: [-18, 26, -26],
  },
};

export const CATEGORY_TO_DOMAIN: Record<string, MacroDomainId> = {
  'AI Agents': 'Intelligence',
  'AI Memory': 'Intelligence',
  'AI Decision Models': 'Intelligence',
  'AI Evaluation': 'Intelligence',
  'Browser Agents': 'Intelligence',
  'Agent Infrastructure': 'Infrastructure',
  'MCP': 'Infrastructure',
  'MCP Infrastructure': 'Infrastructure',
  'LLM Infrastructure': 'Infrastructure',
  'Data Infrastructure': 'Infrastructure',
  'Cloud Infrastructure': 'Infrastructure',
  'Cloud AI': 'Infrastructure',
  'Search Infrastructure': 'Infrastructure',
  'Local AI': 'Infrastructure',
  'Developer Tools': 'Engineering',
  'Automation': 'Engineering',
  'CAD AI': 'Engineering',
  'Data & Office AI': 'Engineering',
  'Document AI': 'Engineering',
  'Mobile AI': 'Engineering',
  'Voice AI': 'Perception',
  'Audio AI': 'Perception',
  'Image AI': 'Creative Systems',
  'Video AI': 'Creative Systems',
  'Design AI': 'Creative Systems',
  'Cybersecurity': 'Security',
  'AI Security': 'Security',
  'MCP Security': 'Security',
  'Research AI': 'Frontier Research',
  'Robotics': 'Frontier Research',
  'AI Hardware': 'Frontier Research',
};

export function resolveDomain(category: string): MacroDomainId {
  return CATEGORY_TO_DOMAIN[category] ?? 'Frontier Research';
}
