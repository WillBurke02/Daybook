// Learn's API: the generic calls, plus what comes next and the record of answers.
import { api as core, qs } from './core/api.js';

const { get, send } = core;
export const api = {
  ...core,
  feed:     (n, exclude = [], subjects, at = 0) => get(`feed${qs({ n, exclude: exclude.join(','), subjects, at })}`),
  due:      () => get('due'),
  lesson:   id => get(`lesson${qs({ id })}`),
  place:    (lesson_id, pos, finished) => send('lesson/place', { lesson_id, pos, finished }),
  practice: (lessons, n = 10) => get(`practice${qs({ lessons: lessons.join(','), n })}`),
  answer:   b => send('answer', b),
  saveCard: card_id => send('save', { card_id }),
  today:    () => get('today'),
  importCsv: text => send('import', { text }),
  plan:     () => get('plan'),
  levels:   () => get('levels'),
  notes:    (lesson_id, notes) => send('lesson/notes', { lesson_id, notes }),
  subjectNotes: subject => get(`notes${qs({ subject })}`),
  formulas: () => get('formulas'),
  report:   (card_id, note) => send('report', { card_id, note }),
  rework:   () => get('rework'),
  calStart: (subject, said) => send('calibrate/start', { subject, said }),
  calNext:  (subject, asked) => send('calibrate/next', { subject, asked }),
  checkpoint: unit => get(`checkpoint${qs({ unit })}`),
  testout:  lesson => get(`testout${qs({ lesson })}`),
  testoutDone: (lesson, right, asked) => send('testout/done', { lesson, right, asked }),
  comeback: () => get('comeback'),
};
