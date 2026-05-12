/**
 * Unified Airtable Formula Function Registry
 * Single source of truth for all function definitions used across language services.
 * No imports from 'vscode' — pure data module.
 */

export interface FunctionInfo {
    signature: string;
    description: string;
    category: FunctionCategory;
}

export type FunctionCategory =
    | 'Text'
    | 'Numeric'
    | 'Date/Time'
    | 'Logical'
    | 'Array'
    | 'Regex'
    | 'Record'
    | 'Misc';

/**
 * Complete registry of all Airtable functions with signatures and descriptions.
 * D-05: TRUE/FALSE added to Logical; TEXT removed (not a real Airtable formula function).
 * D-06: This is the sole source of truth — diagnostics, completions, hover, signature all derive from here.
 */
export const FUNCTION_REGISTRY: Record<string, FunctionInfo> = {
    // Text functions
    'CONCATENATE': { signature: 'CONCATENATE(text1, text2, ...)', description: 'Joins together two or more text strings into one', category: 'Text' },
    'LEFT': { signature: 'LEFT(string, howMany)', description: 'Extracts characters from the beginning of a string', category: 'Text' },
    'RIGHT': { signature: 'RIGHT(string, howMany)', description: 'Extracts characters from the end of a string', category: 'Text' },
    'MID': { signature: 'MID(string, whereToStart, count)', description: 'Extracts characters from the middle of a string', category: 'Text' },
    'LEN': { signature: 'LEN(string)', description: 'Returns the length of a string', category: 'Text' },
    'FIND': { signature: 'FIND(stringToFind, whereToSearch, [startFromPosition])', description: 'Locates a substring within a string (case-sensitive)', category: 'Text' },
    'SEARCH': { signature: 'SEARCH(stringToFind, whereToSearch, [startFromPosition])', description: 'Locates a substring within a string (case-insensitive)', category: 'Text' },
    'SUBSTITUTE': { signature: 'SUBSTITUTE(string, old_text, new_text, [index])', description: 'Replaces occurrences of old text with new text', category: 'Text' },
    'REPLACE': { signature: 'REPLACE(string, start_character, number_of_characters, replacement)', description: 'Replaces characters in a string based on position', category: 'Text' },
    'TRIM': { signature: 'TRIM(string)', description: 'Removes leading and trailing whitespace', category: 'Text' },
    'UPPER': { signature: 'UPPER(string)', description: 'Converts text to uppercase', category: 'Text' },
    'LOWER': { signature: 'LOWER(string)', description: 'Converts text to lowercase', category: 'Text' },
    'VALUE': { signature: 'VALUE(text)', description: 'Converts a text string to a number', category: 'Text' },
    'T': { signature: 'T(value)', description: 'Returns the value if it is text, otherwise returns empty string', category: 'Text' },
    'REPT': { signature: 'REPT(text, number)', description: 'Repeats text a specified number of times', category: 'Text' },

    // Numeric functions
    'ABS': { signature: 'ABS(number)', description: 'Returns the absolute value of a number', category: 'Numeric' },
    'AVERAGE': { signature: 'AVERAGE(number1, number2, ...)', description: 'Calculates the average of numbers', category: 'Numeric' },
    'CEILING': { signature: 'CEILING(number, [significance])', description: 'Rounds a number up to the nearest integer or significance', category: 'Numeric' },
    'COUNT': { signature: 'COUNT(value1, value2, ...)', description: 'Counts the number of non-empty numeric values', category: 'Numeric' },
    'COUNTA': { signature: 'COUNTA(value1, value2, ...)', description: 'Counts the number of non-empty values', category: 'Numeric' },
    'COUNTALL': { signature: 'COUNTALL(value1, value2, ...)', description: 'Counts all values including blanks', category: 'Numeric' },
    'EXP': { signature: 'EXP(power)', description: 'Returns e raised to the specified power', category: 'Numeric' },
    'FLOOR': { signature: 'FLOOR(number, [significance])', description: 'Rounds a number down to the nearest integer or significance', category: 'Numeric' },
    'INT': { signature: 'INT(number)', description: 'Returns the integer portion of a number', category: 'Numeric' },
    'LOG': { signature: 'LOG(number, [base])', description: 'Returns the logarithm of a number to a specified base', category: 'Numeric' },
    'MAX': { signature: 'MAX(number1, number2, ...)', description: 'Returns the maximum value', category: 'Numeric' },
    'MIN': { signature: 'MIN(number1, number2, ...)', description: 'Returns the minimum value', category: 'Numeric' },
    'MOD': { signature: 'MOD(number, divisor)', description: 'Returns the remainder after dividing a number by a divisor', category: 'Numeric' },
    'POWER': { signature: 'POWER(base, exponent)', description: 'Returns a number raised to a power', category: 'Numeric' },
    'ROUND': { signature: 'ROUND(number, precision)', description: 'Rounds a number to a specified precision', category: 'Numeric' },
    'ROUNDDOWN': { signature: 'ROUNDDOWN(number, precision)', description: 'Rounds a number down', category: 'Numeric' },
    'ROUNDUP': { signature: 'ROUNDUP(number, precision)', description: 'Rounds a number up', category: 'Numeric' },
    'SQRT': { signature: 'SQRT(number)', description: 'Returns the square root of a number', category: 'Numeric' },
    'SUM': { signature: 'SUM(number1, number2, ...)', description: 'Adds numbers together', category: 'Numeric' },
    'ODD': { signature: 'ODD(number)', description: 'Rounds a number up to the nearest odd integer', category: 'Numeric' },
    'EVEN': { signature: 'EVEN(number)', description: 'Rounds a number up to the nearest even integer', category: 'Numeric' },

    // Date/Time functions
    'TODAY': { signature: 'TODAY()', description: 'Returns today\'s date', category: 'Date/Time' },
    'NOW': { signature: 'NOW()', description: 'Returns the current date and time', category: 'Date/Time' },
    'DATEADD': { signature: 'DATEADD(date, count, units)', description: 'Adds time to a date', category: 'Date/Time' },
    'DATEDIF': { signature: 'DATEDIF(start_date, end_date, unit)', description: 'Calculates the difference between two dates (legacy)', category: 'Date/Time' },
    'DATETIME_DIFF': { signature: 'DATETIME_DIFF(date1, date2, units)', description: 'Calculates the difference between two dates', category: 'Date/Time' },
    'DATETIME_FORMAT': { signature: 'DATETIME_FORMAT(date, format_specifier)', description: 'Formats a date into a string', category: 'Date/Time' },
    'DATETIME_PARSE': { signature: 'DATETIME_PARSE(date_string, format_specifier)', description: 'Parses a string into a date', category: 'Date/Time' },
    'DATESTR': { signature: 'DATESTR(date)', description: 'Converts a date to a string in ISO format', category: 'Date/Time' },
    'DAY': { signature: 'DAY(date)', description: 'Returns the day of the month', category: 'Date/Time' },
    'HOUR': { signature: 'HOUR(datetime)', description: 'Returns the hour component of a datetime', category: 'Date/Time' },
    'MINUTE': { signature: 'MINUTE(datetime)', description: 'Returns the minute component of a datetime', category: 'Date/Time' },
    'MONTH': { signature: 'MONTH(date)', description: 'Returns the month from a date', category: 'Date/Time' },
    'SECOND': { signature: 'SECOND(datetime)', description: 'Returns the second component of a datetime', category: 'Date/Time' },
    'SET_LOCALE': { signature: 'SET_LOCALE(date, locale_string)', description: 'Sets the locale for date formatting', category: 'Date/Time' },
    'SET_TIMEZONE': { signature: 'SET_TIMEZONE(date, timezone_string)', description: 'Sets the timezone for a date', category: 'Date/Time' },
    'TIMESTR': { signature: 'TIMESTR(datetime)', description: 'Converts a time to a string', category: 'Date/Time' },
    'TONOW': { signature: 'TONOW(date)', description: 'Returns the duration from a date until now', category: 'Date/Time' },
    'FROMNOW': { signature: 'FROMNOW(date)', description: 'Returns the duration from now until a date', category: 'Date/Time' },
    'WEEKDAY': { signature: 'WEEKDAY(date, [start_day_of_week])', description: 'Returns the day of the week', category: 'Date/Time' },
    'WEEKNUM': { signature: 'WEEKNUM(date, [start_day_of_week])', description: 'Returns the week number of the year', category: 'Date/Time' },
    'WORKDAY': { signature: 'WORKDAY(start_date, num_days, [holidays])', description: 'Returns a date that is a specified number of workdays away', category: 'Date/Time' },
    'WORKDAY_DIFF': { signature: 'WORKDAY_DIFF(start_date, end_date, [holidays])', description: 'Returns the number of workdays between two dates', category: 'Date/Time' },
    'YEAR': { signature: 'YEAR(date)', description: 'Returns the year from a date', category: 'Date/Time' },

    // Logical functions
    'IF': { signature: 'IF(logical, value_if_true, value_if_false)', description: 'Returns one value if condition is true, another if false', category: 'Logical' },
    'AND': { signature: 'AND(logical1, logical2, ...)', description: 'Returns true if all conditions are true', category: 'Logical' },
    'OR': { signature: 'OR(logical1, logical2, ...)', description: 'Returns true if any condition is true', category: 'Logical' },
    'NOT': { signature: 'NOT(logical)', description: 'Returns the opposite of a logical value', category: 'Logical' },
    'XOR': { signature: 'XOR(logical1, logical2, ...)', description: 'Returns true if an odd number of arguments are true', category: 'Logical' },
    'SWITCH': { signature: 'SWITCH(expression, pattern1, result1, pattern2, result2, ..., default)', description: 'Evaluates an expression and returns corresponding result', category: 'Logical' },
    'IS_SAME': { signature: 'IS_SAME(date1, date2, [unit])', description: 'Returns true if two dates are the same', category: 'Logical' },
    'IS_AFTER': { signature: 'IS_AFTER(date1, date2)', description: 'Returns true if the first date is after the second', category: 'Logical' },
    'IS_BEFORE': { signature: 'IS_BEFORE(date1, date2)', description: 'Returns true if the first date is before the second', category: 'Logical' },
    'ISERROR': { signature: 'ISERROR(value)', description: 'Tests if a value is an error', category: 'Logical' },
    'ERROR': { signature: 'ERROR(message)', description: 'Returns an error value with a message', category: 'Logical' },
    'BLANK': { signature: 'BLANK()', description: 'Returns a blank value', category: 'Logical' },
    'TRUE': { signature: 'TRUE()', description: 'Returns boolean true (1). Can be used with or without parentheses.', category: 'Logical' },
    'FALSE': { signature: 'FALSE()', description: 'Returns boolean false (0). Can be used with or without parentheses.', category: 'Logical' },

    // Array functions
    'ARRAYCOMPACT': { signature: 'ARRAYCOMPACT(array)', description: 'Removes empty values from an array', category: 'Array' },
    'ARRAYJOIN': { signature: 'ARRAYJOIN(array, separator)', description: 'Joins array elements into a single string', category: 'Array' },
    'ARRAYUNIQUE': { signature: 'ARRAYUNIQUE(array)', description: 'Returns unique values from an array', category: 'Array' },
    'ARRAYFLATTEN': { signature: 'ARRAYFLATTEN(array)', description: 'Flattens nested arrays into a single array', category: 'Array' },
    'ARRAYSLICE': { signature: 'ARRAYSLICE(array, start, [end])', description: 'Returns a slice of an array from start to end', category: 'Array' },

    // Regex functions
    'REGEX_MATCH': { signature: 'REGEX_MATCH(text, regex)', description: 'Tests if text matches a regular expression pattern', category: 'Regex' },
    'REGEX_EXTRACT': { signature: 'REGEX_EXTRACT(text, regex)', description: 'Extracts text matching a regular expression pattern', category: 'Regex' },
    'REGEX_REPLACE': { signature: 'REGEX_REPLACE(text, regex, replacement)', description: 'Replaces text matching a regular expression pattern', category: 'Regex' },

    // Record functions
    'RECORD_ID': { signature: 'RECORD_ID()', description: 'Returns the unique ID of the current record', category: 'Record' },
    'CREATED_TIME': { signature: 'CREATED_TIME()', description: 'Returns when the record was created', category: 'Record' },
    'LAST_MODIFIED_TIME': { signature: 'LAST_MODIFIED_TIME()', description: 'Returns when the record was last modified', category: 'Record' },

    // Misc functions
    'ENCODE_URL_COMPONENT': { signature: 'ENCODE_URL_COMPONENT(text)', description: 'Encodes text for use in a URL', category: 'Misc' },
};

/**
 * Constants that can be used with or without parentheses (D-05: 5 entries including TRUE/FALSE)
 */
export const CALLABLE_CONSTANTS = ['NOW', 'TODAY', 'BLANK', 'TRUE', 'FALSE'] as const;
export type CallableConstant = typeof CALLABLE_CONSTANTS[number];

/**
 * All function names as an array
 */
export const ALL_FUNCTION_NAMES = Object.keys(FUNCTION_REGISTRY);

/**
 * All callable identifiers (functions + callable constants)
 */
export const ALL_CALLABLE = [...new Set([...ALL_FUNCTION_NAMES, ...CALLABLE_CONSTANTS])];

/**
 * Get functions by category
 */
export function getFunctionsByCategory(category: FunctionCategory): string[] {
    return ALL_FUNCTION_NAMES.filter(name => FUNCTION_REGISTRY[name].category === category);
}

/**
 * Check if a name is a valid Airtable function or callable constant
 */
export function isValidCallable(name: string): boolean {
    return ALL_CALLABLE.includes(name);
}

/**
 * Get function info by name
 */
export function getFunctionInfo(name: string): FunctionInfo | undefined {
    return FUNCTION_REGISTRY[name];
}

/**
 * Smart quotes that should be replaced with straight quotes.
 * Migrated from packages/extension/src/diagnostics.ts.
 */
export const SMART_QUOTES: Record<string, string> = {
    '“': '"', // "
    '”': '"', // "
    '‘': "'", // '
    '’': "'", // '
};

/**
 * Common typos and Excel functions that don't exist in Airtable.
 * Migrated from packages/extension/src/diagnostics.ts.
 */
export const COMMON_TYPOS: Record<string, string> = {
    'CONCATINATE': 'CONCATENATE',
    'CONCATNATE': 'CONCATENATE',
    'SUBSTITUDE': 'SUBSTITUTE',
    'SUBSTUTE': 'SUBSTITUTE',
    'SUMIF': 'SUM (SUMIF not available)',
    'COUNTIF': 'COUNT (COUNTIF not available)',
    'VLOOKUP': 'linked records (VLOOKUP not available)',
    'HLOOKUP': 'linked records (HLOOKUP not available)',
    'INDEX': 'ARRAYSLICE',
    'IFERROR': 'IF(ISERROR(...), ...)',
    'ISBLANK': 'IF({Field}, FALSE, TRUE)',
    'DATEVALUE': 'DATETIME_PARSE',
    'TIMEVALUE': 'DATETIME_PARSE',
    'DATEDIFF': 'DATETIME_DIFF',
    'CONCAT': 'CONCATENATE or &',
};

/**
 * Computes the Levenshtein edit distance between two strings.
 * Used for fuzzy function name matching in diagnostics.
 * Migrated verbatim from packages/extension/src/diagnostics.ts.
 */
export function levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
        dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j],     // deletion
                    dp[i][j - 1],     // insertion
                    dp[i - 1][j - 1]  // substitution
                );
            }
        }
    }

    return dp[m][n];
}
