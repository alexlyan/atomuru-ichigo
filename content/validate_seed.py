#!/usr/bin/env python3
"""Validate the Japanese seed data (vocabulary.json and grammar.json).

Usage:
    python3 content/validate_seed.py [vocabulary.json] [grammar.json]

Defaults to content/ja/vocabulary.json and content/ja/grammar.json next to this script.
Exits with status 1 if any error is found. Standard library only.
"""
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_VOCAB = os.path.join(HERE, 'ja', 'vocabulary.json')
DEFAULT_GRAMMAR = os.path.join(HERE, 'ja', 'grammar.json')

WORD_TYPES = {
    'verb', 'noun', 'i-adjective', 'na-adjective', 'adverb', 'particle',
    'expression', 'pronoun', 'question-word', 'conjunction',
}
VOCAB_REQUIRED = ('text', 'reading_kana', 'romaji', 'primary_meaning', 'word_type')
GRAMMAR_REQUIRED = ('title', 'summary', 'explanation_md')
MAX_ALTS = 5

ROMAJI_RE = re.compile(r"^[a-z' -]+$")
# hiragana U+3041-3096, katakana U+30A1-30FA, prolonged sound mark U+30FC
KANA_RE = re.compile(r'^[ぁ-ゖァ-ヺー]+$')
BRACKET_RE = re.compile(r'^[^\[\]]*\[[^\[\]]+\][^\[\]]*$')


def load(path, errors):
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        errors.append(f'{path}: cannot load JSON: {e}')
        return None
    if not isinstance(data, list):
        errors.append(f'{path}: top level must be an array')
        return None
    return data


def nonempty_str(v):
    return isinstance(v, str) and v.strip() != ''


def check_str_list(where, name, value, errors, max_len=None):
    if not isinstance(value, list) or not all(nonempty_str(x) for x in value):
        errors.append(f'{where}: "{name}" must be a list of non-empty strings')
        return
    if max_len is not None and len(value) > max_len:
        errors.append(f'{where}: "{name}" has {len(value)} items (max {max_len})')


def validate_vocab(items, errors):
    for i, it in enumerate(items):
        where = f'vocabulary[{i}] {it.get("text", "?")!r}' if isinstance(it, dict) else f'vocabulary[{i}]'
        if not isinstance(it, dict):
            errors.append(f'{where}: must be an object'); continue
        for k in VOCAB_REQUIRED:
            if not nonempty_str(it.get(k)):
                errors.append(f'{where}: missing or empty "{k}"')
        wt = it.get('word_type')
        if nonempty_str(wt) and wt not in WORD_TYPES:
            errors.append(f'{where}: word_type {wt!r} not allowed')
        check_str_list(where, 'alt_meanings', it.get('alt_meanings', []), errors, MAX_ALTS)
        check_str_list(where, 'categories', it.get('categories', []), errors)
        r = it.get('romaji')
        if nonempty_str(r) and not ROMAJI_RE.match(r):
            errors.append(f'{where}: romaji {r!r} must be lowercase ASCII letters, spaces, hyphens, apostrophes')
        k = it.get('reading_kana')
        if nonempty_str(k) and not KANA_RE.match(k):
            errors.append(f'{where}: reading_kana {k!r} must contain only hiragana/katakana/ー')
    dupes = [t for t, n in Counter(it.get('text') for it in items if isinstance(it, dict)).items() if n > 1]
    for t in dupes:
        errors.append(f'vocabulary: duplicate text {t!r}')


def validate_grammar(entries, errors):
    for i, g in enumerate(entries):
        where = f'grammar[{i}] {g.get("title", "?")!r}' if isinstance(g, dict) else f'grammar[{i}]'
        if not isinstance(g, dict):
            errors.append(f'{where}: must be an object'); continue
        for k in GRAMMAR_REQUIRED:
            if not nonempty_str(g.get(k)):
                errors.append(f'{where}: missing or empty "{k}"')
        check_str_list(where, 'summary_alts', g.get('summary_alts', []), errors, MAX_ALTS)
        check_str_list(where, 'categories', g.get('categories', []), errors)
        examples = g.get('examples', [])
        if not isinstance(examples, list):
            errors.append(f'{where}: "examples" must be a list'); continue
        for j, ex in enumerate(examples):
            ew = f'{where} example[{j}]'
            if not isinstance(ex, dict):
                errors.append(f'{ew}: must be an object'); continue
            ja = ex.get('ja')
            if not nonempty_str(ja):
                errors.append(f'{ew}: missing or empty "ja"')
            elif not BRACKET_RE.match(ja):
                errors.append(f'{ew}: "ja" must contain exactly one non-empty [ ... ] pair: {ja!r}')
            if not nonempty_str(ex.get('translation')):
                errors.append(f'{ew}: missing or empty "translation"')
    titles = [t for t, n in Counter(g.get('title') for g in entries if isinstance(g, dict)).items() if n > 1]
    for t in titles:
        errors.append(f'grammar: duplicate title {t!r}')


def main(argv):
    vocab_path = argv[1] if len(argv) > 1 else DEFAULT_VOCAB
    grammar_path = argv[2] if len(argv) > 2 else DEFAULT_GRAMMAR
    errors = []
    vocab = load(vocab_path, errors)
    grammar = load(grammar_path, errors)
    if vocab is not None:
        validate_vocab(vocab, errors)
    if grammar is not None:
        validate_grammar(grammar, errors)

    if vocab is not None:
        types = Counter(it.get('word_type') for it in vocab if isinstance(it, dict))
        print(f'vocabulary: {len(vocab)} items  ' + ', '.join(f'{k}={v}' for k, v in types.most_common()))
    if grammar is not None:
        n_ex = sum(len(g.get('examples') or []) for g in grammar if isinstance(g, dict))
        print(f'grammar: {len(grammar)} entries, {n_ex} examples')
    if errors:
        for e in errors:
            print('ERROR', e)
        print(f'FAILED: {len(errors)} error(s)')
        return 1
    print('OK: no errors')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
