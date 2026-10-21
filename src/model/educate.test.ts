import { describe, expect, it } from 'vitest'
import { EducateTopic, subtopicId } from './schema'

describe('educate subtopics', () => {
  it('a plain title becomes a subtopic whose id derives from its topic', () => {
    const t = EducateTopic.parse({ id: 'rparch-profiles', title: 'Profiles', subtopics: ['LoA High: haip-vp', 'DC-API'] })
    expect(t.subtopics.map((s) => s.id)).toEqual(['rparch-profiles.loa-high-haip-vp', 'rparch-profiles.dc-api'])
    expect(t.subtopics[0]).toMatchObject({ title: 'LoA High: haip-vp', links: [], questions: [] })
  })

  it('a subtopic with content keeps its own id, also after a rename', () => {
    const t = EducateTopic.parse({
      id: 'rparch-binding',
      title: 'Types of Binding',
      subtopics: [{ id: 'rparch-binding.key-binding', title: 'Holder key binding', summary: 'Proves the key.' }],
    })
    expect(t.subtopics[0]!.id).toBe('rparch-binding.key-binding')
  })

  it('ids drop accents and punctuation', () => {
    expect(subtopicId('isarch-auth', 'Keine Äuth (Pre)')).toBe('isarch-auth.keine-auth-pre')
  })
})
