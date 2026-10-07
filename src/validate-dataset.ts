import { loadCorpus, loadGolden, validateDataset } from './dataset';

const corpus = loadCorpus('data/corpus');
const cases = loadGolden('data/golden.json');
const { errors, warnings } = validateDataset(corpus, cases);

const answerable = cases.filter((c) => c.answerable).length;
console.log(`${corpus.length} documents, ${cases.length} cases (${answerable} answerable, ${cases.length - answerable} unanswerable)`);
warnings.forEach((w) => console.warn(`warning: ${w}`));
errors.forEach((e) => console.error(`error: ${e}`));

if (errors.length > 0) process.exit(1);
console.log('Dataset is valid: every expected fact is stated in its source documents.');
