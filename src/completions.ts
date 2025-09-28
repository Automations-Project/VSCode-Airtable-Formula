import * as vscode from 'vscode';

// Function signatures with descriptions
const FUNCTION_SIGNATURES: { [key: string]: { signature: string; description: string; detail?: string } } = {
    // Text functions
    'CONCATENATE': {
        signature: 'CONCATENATE(text1, text2, ...)',
        description: 'Joins together two or more text strings into one',
        detail: 'Text'
    },
    'LEFT': {
        signature: 'LEFT(string, howMany)',
        description: 'Extracts characters from the beginning of a string',
        detail: 'Text'
    },
    'RIGHT': {
        signature: 'RIGHT(string, howMany)',
        description: 'Extracts characters from the end of a string',
        detail: 'Text'
    },
    'MID': {
        signature: 'MID(string, whereToStart, count)',
        description: 'Extracts characters from the middle of a string',
        detail: 'Text'
    },
    'LEN': {
        signature: 'LEN(string)',
        description: 'Returns the length of a string',
        detail: 'Text'
    },
    'FIND': {
        signature: 'FIND(stringToFind, whereToSearch, [startFromPosition])',
        description: 'Locates a substring within a string (case-sensitive)',
        detail: 'Text'
    },
    'SEARCH': {
        signature: 'SEARCH(stringToFind, whereToSearch, [startFromPosition])',
        description: 'Locates a substring within a string (case-insensitive)',
        detail: 'Text'
    },
    'SUBSTITUTE': {
        signature: 'SUBSTITUTE(string, old_text, new_text, [index])',
        description: 'Replaces occurrences of old text with new text',
        detail: 'Text'
    },
    'REPLACE': {
        signature: 'REPLACE(string, start_character, number_of_characters, replacement)',
        description: 'Replaces characters in a string based on position',
        detail: 'Text'
    },
    'TRIM': {
        signature: 'TRIM(string)',
        description: 'Removes leading and trailing whitespace',
        detail: 'Text'
    },
    'UPPER': {
        signature: 'UPPER(string)',
        description: 'Converts text to uppercase',
        detail: 'Text'
    },
    'LOWER': {
        signature: 'LOWER(string)',
        description: 'Converts text to lowercase',
        detail: 'Text'
    },
    'VALUE': {
        signature: 'VALUE(text)',
        description: 'Converts a text string to a number',
        detail: 'Text'
    },

    // Numeric functions
    'SUM': {
        signature: 'SUM(number1, number2, ...)',
        description: 'Adds numbers together',
        detail: 'Numeric'
    },
    'AVERAGE': {
        signature: 'AVERAGE(number1, number2, ...)',
        description: 'Calculates the average of numbers',
        detail: 'Numeric'
    },
    'MAX': {
        signature: 'MAX(number1, number2, ...)',
        description: 'Returns the maximum value',
        detail: 'Numeric'
    },
    'MIN': {
        signature: 'MIN(number1, number2, ...)',
        description: 'Returns the minimum value',
        detail: 'Numeric'
    },
    'ROUND': {
        signature: 'ROUND(number, precision)',
        description: 'Rounds a number to a specified precision',
        detail: 'Numeric'
    },
    'ROUNDUP': {
        signature: 'ROUNDUP(number, precision)',
        description: 'Rounds a number up',
        detail: 'Numeric'
    },
    'ROUNDDOWN': {
        signature: 'ROUNDDOWN(number, precision)',
        description: 'Rounds a number down',
        detail: 'Numeric'
    },
    'COUNT': {
        signature: 'COUNT(value1, value2, ...)',
        description: 'Counts the number of non-empty numeric values',
        detail: 'Numeric'
    },
    'COUNTA': {
        signature: 'COUNTA(value1, value2, ...)',
        description: 'Counts the number of non-empty values',
        detail: 'Numeric'
    },

    // Date/Time functions
    'TODAY': {
        signature: 'TODAY()',
        description: 'Returns today\'s date',
        detail: 'Date/Time'
    },
    'NOW': {
        signature: 'NOW()',
        description: 'Returns the current date and time',
        detail: 'Date/Time'
    },
    'DATEADD': {
        signature: 'DATEADD(date, count, units)',
        description: 'Adds time to a date',
        detail: 'Date/Time'
    },
    'DATETIME_DIFF': {
        signature: 'DATETIME_DIFF(date1, date2, units)',
        description: 'Calculates the difference between two dates',
        detail: 'Date/Time'
    },
    'DATETIME_FORMAT': {
        signature: 'DATETIME_FORMAT(date, format_specifier)',
        description: 'Formats a date into a string',
        detail: 'Date/Time'
    },
    'DATETIME_PARSE': {
        signature: 'DATETIME_PARSE(date_string, format_specifier)',
        description: 'Parses a string into a date',
        detail: 'Date/Time'
    },
    'DAY': {
        signature: 'DAY(date)',
        description: 'Returns the day of the month',
        detail: 'Date/Time'
    },
    'MONTH': {
        signature: 'MONTH(date)',
        description: 'Returns the month from a date',
        detail: 'Date/Time'
    },
    'YEAR': {
        signature: 'YEAR(date)',
        description: 'Returns the year from a date',
        detail: 'Date/Time'
    },
    'WEEKDAY': {
        signature: 'WEEKDAY(date, [start_day_of_week])',
        description: 'Returns the day of the week',
        detail: 'Date/Time'
    },

    // Logical functions
    'IF': {
        signature: 'IF(logical, value_if_true, value_if_false)',
        description: 'Returns one value if condition is true, another if false',
        detail: 'Logical'
    },
    'AND': {
        signature: 'AND(logical1, logical2, ...)',
        description: 'Returns true if all conditions are true',
        detail: 'Logical'
    },
    'OR': {
        signature: 'OR(logical1, logical2, ...)',
        description: 'Returns true if any condition is true',
        detail: 'Logical'
    },
    'NOT': {
        signature: 'NOT(logical)',
        description: 'Returns the opposite of a logical value',
        detail: 'Logical'
    },
    'SWITCH': {
        signature: 'SWITCH(expression, pattern1, result1, pattern2, result2, ..., default)',
        description: 'Evaluates an expression and returns corresponding result',
        detail: 'Logical'
    },
    'BLANK': {
        signature: 'BLANK()',
        description: 'Returns a blank value',
        detail: 'Logical'
    },
    'ERROR': {
        signature: 'ERROR(message)',
        description: 'Returns an error value with a message',
        detail: 'Logical'
    },
    'ISERROR': {
        signature: 'ISERROR(value)',
        description: 'Tests if a value is an error',
        detail: 'Logical'
    },

    // Array functions
    'ARRAYJOIN': {
        signature: 'ARRAYJOIN(array, separator)',
        description: 'Joins array elements into a single string',
        detail: 'Array'
    },
    'ARRAYUNIQUE': {
        signature: 'ARRAYUNIQUE(array)',
        description: 'Returns unique values from an array',
        detail: 'Array'
    },
    'ARRAYCOMPACT': {
        signature: 'ARRAYCOMPACT(array)',
        description: 'Removes empty values from an array',
        detail: 'Array'
    },
    'ARRAYFLATTEN': {
        signature: 'ARRAYFLATTEN(array)',
        description: 'Flattens nested arrays into a single array',
        detail: 'Array'
    },

    // Regex functions
    'REGEX_MATCH': {
        signature: 'REGEX_MATCH(text, regex)',
        description: 'Tests if text matches a regular expression pattern',
        detail: 'Regex'
    },
    'REGEX_EXTRACT': {
        signature: 'REGEX_EXTRACT(text, regex)',
        description: 'Extracts text matching a regular expression pattern',
        detail: 'Regex'
    },
    'REGEX_REPLACE': {
        signature: 'REGEX_REPLACE(text, regex, replacement)',
        description: 'Replaces text matching a regular expression pattern',
        detail: 'Regex'
    },

    // Record functions
    'RECORD_ID': {
        signature: 'RECORD_ID()',
        description: 'Returns the unique ID of the current record',
        detail: 'Record'
    },
    'CREATED_TIME': {
        signature: 'CREATED_TIME()',
        description: 'Returns when the record was created',
        detail: 'Record'
    },
    'LAST_MODIFIED_TIME': {
        signature: 'LAST_MODIFIED_TIME()',
        description: 'Returns when the record was last modified',
        detail: 'Record'
    }
};

export class AirtableFormulaCompletionProvider implements vscode.CompletionItemProvider {
    
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] | vscode.CompletionList {
        
        const completions: vscode.CompletionItem[] = [];
        
        // Add function completions
        for (const [func, info] of Object.entries(FUNCTION_SIGNATURES)) {
            const item = new vscode.CompletionItem(func, vscode.CompletionItemKind.Function);
            item.insertText = new vscode.SnippetString(`${func}($0)`);
            item.documentation = new vscode.MarkdownString(`**${info.signature}**\n\n${info.description}`);
            item.detail = info.detail;
            completions.push(item);
        }

        // Add constants
        const constants = ['TRUE', 'FALSE', 'BLANK()', 'NOW()', 'TODAY()'];
        for (const constant of constants) {
            const item = new vscode.CompletionItem(constant, vscode.CompletionItemKind.Constant);
            item.insertText = constant;
            completions.push(item);
        }

        // Add common date units
        const wordRange = document.getWordRangeAtPosition(position);
        const word = wordRange ? document.getText(wordRange) : '';
        
        if (word === '' || ['days', 'weeks', 'months', 'years', 'hours', 'minutes', 'seconds'].some(u => u.startsWith(word))) {
            const units = ['days', 'weeks', 'months', 'years', 'hours', 'minutes', 'seconds'];
            for (const unit of units) {
                const item = new vscode.CompletionItem(`'${unit}'`, vscode.CompletionItemKind.Value);
                item.insertText = `'${unit}'`;
                item.detail = 'Date/Time unit';
                completions.push(item);
            }
        }

        return completions;
    }
}
