import { describe, it, expect } from 'vitest'
import { tokenizeTlLine } from '../src/tl-highlight.js'

// Compact view of the tokenizer output for assertions.
const toks = (line: string) =>
    tokenizeTlLine(line)
        .filter(t => t.cls !== '') // drop whitespace
        .map(t => [t.cls, t.text] as const)

describe('tokenizeTlLine', () => {
    it('round-trips the original line (whitespace included)', () => {
        const line = 'messages.sendMessage#fe2c1eef silent:flags.5?true peer:InputPeer message:string = Updates;'
        expect(tokenizeTlLine(line).map(t => t.text).join('')).toBe(line)
    })

    it('splits namespace, name and #crc id', () => {
        expect(toks('inputPeerEmpty#7f3b18ea = InputPeer;')).toEqual([
            ['tlk-name', 'inputPeerEmpty'],
            ['tlk-id', '#7f3b18ea'],
            ['tlk-punct', '='],
            ['tlk-type', 'InputPeer'],
            ['tlk-punct', ';'],
        ])
        expect(toks('messages.getDialogs#a0f4cb4f = messages.Dialogs;')).toEqual([
            ['tlk-ns', 'messages.'],
            ['tlk-name', 'getDialogs'],
            ['tlk-id', '#a0f4cb4f'],
            ['tlk-punct', '='],
            ['tlk-type', 'messages.Dialogs'],
            ['tlk-punct', ';'],
        ])
    })

    it('colors field names, builtins and boxed types distinctly', () => {
        expect(toks('x#1 a:int b:InputPeer = X;')).toEqual([
            ['tlk-name', 'x'],
            ['tlk-id', '#1'],
            ['tlk-field', 'a'],
            ['tlk-punct', ':'],
            ['tlk-builtin', 'int'],
            ['tlk-field', 'b'],
            ['tlk-punct', ':'],
            ['tlk-type', 'InputPeer'],
            ['tlk-punct', '='],
            ['tlk-type', 'X'],
            ['tlk-punct', ';'],
        ])
    })

    it('handles flags:# (# is punctuation) and splits flags.N? into a muted ref + accented bit', () => {
        expect(toks('m#1 flags:# silent:flags.5?true = X;')).toEqual([
            ['tlk-name', 'm'],
            ['tlk-id', '#1'],
            ['tlk-field', 'flags'],
            ['tlk-punct', ':'],
            ['tlk-punct', '#'],
            ['tlk-field', 'silent'],
            ['tlk-punct', ':'],
            ['tlk-flagword', 'flags'],
            ['tlk-punct', '.'],
            ['tlk-flagbit', '5'],
            ['tlk-punct', '?'],
            ['tlk-builtin', 'true'],
            ['tlk-punct', '='],
            ['tlk-type', 'X'],
            ['tlk-punct', ';'],
        ])
    })

    it('recurses into Vector<…> generics', () => {
        expect(toks('m#1 chats:Vector<Chat> = Vector<int>;')).toEqual([
            ['tlk-name', 'm'],
            ['tlk-id', '#1'],
            ['tlk-field', 'chats'],
            ['tlk-punct', ':'],
            ['tlk-type', 'Vector'],
            ['tlk-punct', '<'],
            ['tlk-type', 'Chat'],
            ['tlk-punct', '>'],
            ['tlk-punct', '='],
            ['tlk-type', 'Vector'],
            ['tlk-punct', '<'],
            ['tlk-builtin', 'int'],
            ['tlk-punct', '>'],
            ['tlk-punct', ';'],
        ])
    })
})
