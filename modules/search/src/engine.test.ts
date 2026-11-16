import { expect, test } from 'vitest'
import { splitLast } from './engine.js'

test('the last word is a prefix only while it is being typed', () => {
  expect(splitLast('blue shi')).toEqual({ head: 'blue ', last: 'shi' })
  expect(splitLast('پیرا')).toEqual({ head: '', last: 'پیرا' })
  // A closing quote, a space or punctuation means the word is finished.
  expect(splitLast('"red shirt"')).toEqual({ head: '"red shirt"' })
  expect(splitLast('shirt ')).toEqual({ head: 'shirt ' })
  expect(splitLast(`&|!:*()'`)).toEqual({ head: `&|!:*()'` })
  expect(splitLast("o'brien")).toEqual({ head: "o'", last: 'brien' })
})
