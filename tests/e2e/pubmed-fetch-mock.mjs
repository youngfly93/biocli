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

globalThis.fetch = async (input) => {
  const url = String(input);
  const parsed = new URL(url);

  if (parsed.hostname === 'eutils.ncbi.nlm.nih.gov' && parsed.pathname.endsWith('/efetch.fcgi') && parsed.searchParams.get('db') === 'pubmed') {
    return new Response(PUBMED_XML, {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    });
  }

  throw new Error(`Unexpected fetch in e2e mock: ${url}`);
};
