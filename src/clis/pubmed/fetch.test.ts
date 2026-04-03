import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import { parseXml } from '../../xml-parser.js';
import type { HttpContext } from '../../types.js';
import '../../clis/pubmed/fetch.js';

const PUBMED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">36766853</PMID>
      <Article>
        <ArticleTitle>The Role of <i>TP53</i> in Adaptation and Evolution.</ArticleTitle>
        <Abstract>
          <AbstractText>The <i>TP53</i> gene is a major player in cancer formation, and the <i>p53</i> protein acts as a transcription factor.</AbstractText>
        </Abstract>
        <Journal>
          <JournalIssue>
            <PubDate>
              <Year>2023</Year>
            </PubDate>
          </JournalIssue>
          <Title>Cells</Title>
        </Journal>
        <AuthorList>
          <Author>
            <LastName>Voskarides</LastName>
            <ForeName>Konstantinos</ForeName>
          </Author>
          <Author>
            <LastName>Giannopoulou</LastName>
            <ForeName>Nefeli</ForeName>
          </Author>
        </AuthorList>
        <ELocationID EIdType="doi">10.3390/cells12030512</ELocationID>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

function makeCtx(): HttpContext {
  return {
    databaseId: 'pubmed',
    fetch: async () => {
      throw new Error('fetch() should not be called in pubmed/fetch adapter test');
    },
    fetchJson: async () => {
      throw new Error('fetchJson() should not be called in pubmed/fetch adapter test');
    },
    fetchText: async () => {
      throw new Error('fetchText() should not be called in pubmed/fetch adapter test');
    },
    fetchXml: async () => parseXml(PUBMED_XML),
  };
}

describe('pubmed/fetch adapter', () => {
  it('preserves inline PubMed markup text in title and abstract', async () => {
    const cmd = getRegistry().get('pubmed/fetch');
    expect(cmd?.func).toBeTypeOf('function');

    const rows = await cmd!.func!(makeCtx(), { pmid: '36766853' });
    expect(rows).toHaveLength(1);
    expect(rows).toEqual([
      expect.objectContaining({
        pmid: '36766853',
        title: 'The Role of TP53 in Adaptation and Evolution.',
        abstract: 'The TP53 gene is a major player in cancer formation, and the p53 protein acts as a transcription factor.',
        journal: 'Cells',
        year: '2023',
        doi: '10.3390/cells12030512',
      }),
    ]);
  });
});
