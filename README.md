This code was written with the help of AI, it works fine, in case of any bugs follow the link: https://github.com/HappyToy010101/Wiki-markup-for-case-languages/issues

# WikiCase Formatter

A specialized tool for languages with complex case systems (German, Russian, Slavic languages, Finnish, Estonian, etc.) that require special handling in wiki markup.

## Purpose

This tool automatically inserts the pipe symbol `|` in wiki links to properly handle grammatical cases. It allows words to appear in the text in their correct grammatical form (declined, conjugated) while maintaining the dictionary form (infinitive/nominative case) for the actual wiki link.

## The Problem

In case-rich languages, words change their endings based on grammatical context. For example:
- Russian: "книга" (book, nominative) → "о книге" (about the book, prepositional)
- German: "der Hund" (the dog, nominative) → "dem Hund" (the dog, dative)

## Solution

The tool automatically formats wiki links as:
[[infinitive_form|displayed_form]]

## Example

**Input:** "Ich sehe den Hund" (German)  
**Output:** "Ich sehe [[Hund|den Hund]]"

This ensures the link points to "Hund" (dictionary form) while displaying "den Hund" (correct grammatical form in the sentence).

## Supported Languages

- German
- Russian
- Other Slavic languages (Polish, Czech, Slovak, etc.)
- Finnish
- Estonian
- Hungarian
- And other case-system languages