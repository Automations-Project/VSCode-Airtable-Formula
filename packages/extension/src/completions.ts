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
    'T': {
        signature: 'T(value)',
        description: 'Returns the value if it is text, otherwise returns empty string',
        detail: 'Text'
    },
    'REPT': {
        signature: 'REPT(text, number)',
        description: 'Repeats text a specified number of times',
        detail: 'Text'
    },
    'TEXT': {
        signature: 'TEXT(value, format)',
        description: 'Formats a number into text with a specified format',
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
    'COUNTALL': {
        signature: 'COUNTALL(value1, value2, ...)',
        description: 'Counts all values including blanks',
        detail: 'Numeric'
    },
    'ABS': {
        signature: 'ABS(number)',
        description: 'Returns the absolute value of a number',
        detail: 'Numeric'
    },
    'CEILING': {
        signature: 'CEILING(number, [significance])',
        description: 'Rounds a number up to the nearest integer or significance',
        detail: 'Numeric'
    },
    'FLOOR': {
        signature: 'FLOOR(number, [significance])',
        description: 'Rounds a number down to the nearest integer or significance',
        detail: 'Numeric'
    },
    'INT': {
        signature: 'INT(number)',
        description: 'Returns the integer portion of a number',
        detail: 'Numeric'
    },
    'EXP': {
        signature: 'EXP(power)',
        description: 'Returns e raised to the specified power',
        detail: 'Numeric'
    },
    'LOG': {
        signature: 'LOG(number, [base])',
        description: 'Returns the logarithm of a number to a specified base',
        detail: 'Numeric'
    },
    'LOG10': {
        signature: 'LOG10(number)',
        description: 'Returns the base-10 logarithm of a number',
        detail: 'Numeric'
    },
    'MOD': {
        signature: 'MOD(number, divisor)',
        description: 'Returns the remainder after dividing a number by a divisor',
        detail: 'Numeric'
    },
    'POWER': {
        signature: 'POWER(base, exponent)',
        description: 'Returns a number raised to a power',
        detail: 'Numeric'
    },
    'SQRT': {
        signature: 'SQRT(number)',
        description: 'Returns the square root of a number',
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
    'WEEKNUM': {
        signature: 'WEEKNUM(date, [start_day_of_week])',
        description: 'Returns the week number of the year',
        detail: 'Date/Time'
    },
    'HOUR': {
        signature: 'HOUR(datetime)',
        description: 'Returns the hour component of a datetime',
        detail: 'Date/Time'
    },
    'MINUTE': {
        signature: 'MINUTE(datetime)',
        description: 'Returns the minute component of a datetime',
        detail: 'Date/Time'
    },
    'SECOND': {
        signature: 'SECOND(datetime)',
        description: 'Returns the second component of a datetime',
        detail: 'Date/Time'
    },
    'DATEDIF': {
        signature: 'DATEDIF(start_date, end_date, unit)',
        description: 'Calculates the difference between two dates (legacy)',
        detail: 'Date/Time'
    },
    'DATESTR': {
        signature: 'DATESTR(date)',
        description: 'Converts a date to a string in ISO format',
        detail: 'Date/Time'
    },
    'TIMESTR': {
        signature: 'TIMESTR(datetime)',
        description: 'Converts a time to a string',
        detail: 'Date/Time'
    },
    'TONOW': {
        signature: 'TONOW(date)',
        description: 'Returns the duration from a date until now',
        detail: 'Date/Time'
    },
    'FROMNOW': {
        signature: 'FROMNOW(date)',
        description: 'Returns the duration from now until a date',
        detail: 'Date/Time'
    },
    'WORKDAY': {
        signature: 'WORKDAY(start_date, num_days, [holidays])',
        description: 'Returns a date that is a specified number of workdays away',
        detail: 'Date/Time'
    },
    'WORKDAY_DIFF': {
        signature: 'WORKDAY_DIFF(start_date, end_date, [holidays])',
        description: 'Returns the number of workdays between two dates',
        detail: 'Date/Time'
    },
    'SET_LOCALE': {
        signature: 'SET_LOCALE(date, locale_string)',
        description: 'Sets the locale for date formatting',
        detail: 'Date/Time'
    },
    'SET_TIMEZONE': {
        signature: 'SET_TIMEZONE(date, timezone_string)',
        description: 'Sets the timezone for a date',
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
    'XOR': {
        signature: 'XOR(logical1, logical2, ...)',
        description: 'Returns true if an odd number of arguments are true',
        detail: 'Logical'
    },
    'IS_SAME': {
        signature: 'IS_SAME(date1, date2, [unit])',
        description: 'Returns true if two dates are the same',
        detail: 'Logical'
    },
    'IS_BEFORE': {
        signature: 'IS_BEFORE(date1, date2)',
        description: 'Returns true if the first date is before the second',
        detail: 'Logical'
    },
    'IS_AFTER': {
        signature: 'IS_AFTER(date1, date2)',
        description: 'Returns true if the first date is after the second',
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
    'ARRAYSLICE': {
        signature: 'ARRAYSLICE(array, start, [end])',
        description: 'Returns a slice of an array from start to end',
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
    },
    'AUTONUMBER': {
        signature: 'AUTONUMBER()',
        description: 'Returns the auto-increment number of the record',
        detail: 'Record'
    },
    'CREATED_BY': {
        signature: 'CREATED_BY()',
        description: 'Returns the user who created the record',
        detail: 'Record'
    },
    'LAST_MODIFIED_BY': {
        signature: 'LAST_MODIFIED_BY()',
        description: 'Returns the user who last modified the record',
        detail: 'Record'
    },

    // Misc functions
    'ENCODE_URL_COMPONENT': {
        signature: 'ENCODE_URL_COMPONENT(text)',
        description: 'Encodes text for use in a URL',
        detail: 'Misc'
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
