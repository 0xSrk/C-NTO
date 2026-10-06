import { describe, expect, it } from 'vitest';
import { DESK_TOOL_TITLES } from '@/engine/agent/catalog';
import { describedDeskTools } from '@/engine/agent/tools';
import { useI18n } from '@/i18n';

describe('A14.1 titres dans desk.describe', () => {
  it('chaque outil porte le titre du catalogue dans la langue active', () => {
    useI18n.setState({ locale: 'en' });
    const tools = describedDeskTools();
    expect(tools.length).toBe(Object.keys(DESK_TOOL_TITLES).length);
    for (const tool of tools) {
      const titles = DESK_TOOL_TITLES[tool.name as keyof typeof DESK_TOOL_TITLES];
      expect(tool.title, tool.name).toBe(titles[1]);
      expect(tool.kind === 'read' || tool.kind === 'write').toBe(true);
    }
    useI18n.setState({ locale: 'fr' });
  });
});
