# Airtable Functions Quick Reference

## Text
| Function | Syntax |
|----------|--------|
| CONCATENATE | `CONCATENATE(text1, text2, ...)` |
| LEFT | `LEFT(string, count)` |
| RIGHT | `RIGHT(string, count)` |
| MID | `MID(string, start, count)` |
| LEN | `LEN(string)` |
| FIND | `FIND(needle, haystack, [start])` |
| SEARCH | `SEARCH(needle, haystack, [start])` |
| SUBSTITUTE | `SUBSTITUTE(string, old, new, [index])` |
| REPLACE | `REPLACE(string, start, count, new)` |
| TRIM | `TRIM(string)` |
| UPPER | `UPPER(string)` |
| LOWER | `LOWER(string)` |
| REPT | `REPT(string, n)` |

## Numeric
| Function | Syntax |
|----------|--------|
| SUM | `SUM(n1, n2, ...)` |
| AVERAGE | `AVERAGE(n1, n2, ...)` |
| MIN | `MIN(n1, n2, ...)` |
| MAX | `MAX(n1, n2, ...)` |
| ROUND | `ROUND(number, precision)` |
| CEILING | `CEILING(number, [significance])` |
| FLOOR | `FLOOR(number, [significance])` |
| ABS | `ABS(number)` |
| MOD | `MOD(number, divisor)` |
| POWER | `POWER(base, exponent)` |
| SQRT | `SQRT(number)` |
| COUNT | `COUNT(values...)` |
| COUNTA | `COUNTA(values...)` |

## Date/Time
| Function | Syntax |
|----------|--------|
| TODAY | `TODAY()` |
| NOW | `NOW()` |
| DATEADD | `DATEADD(date, count, units)` |
| DATETIME_DIFF | `DATETIME_DIFF(d1, d2, units)` |
| DATETIME_FORMAT | `DATETIME_FORMAT(date, format)` |
| DATETIME_PARSE | `DATETIME_PARSE(text, format)` |
| YEAR | `YEAR(date)` |
| MONTH | `MONTH(date)` |
| DAY | `DAY(date)` |
| WEEKDAY | `WEEKDAY(date, [start])` |
| HOUR | `HOUR(datetime)` |
| MINUTE | `MINUTE(datetime)` |

## Logical
| Function | Syntax |
|----------|--------|
| IF | `IF(condition, if_true, if_false)` |
| SWITCH | `SWITCH(expr, p1, r1, ..., default)` |
| AND | `AND(a, b, ...)` |
| OR | `OR(a, b, ...)` |
| NOT | `NOT(expr)` |
| XOR | `XOR(a, b, ...)` |
| ISERROR | `ISERROR(expr)` |
| BLANK | `BLANK()` |

## Array
| Function | Syntax |
|----------|--------|
| ARRAYJOIN | `ARRAYJOIN(array, separator)` |
| ARRAYUNIQUE | `ARRAYUNIQUE(array)` |
| ARRAYCOMPACT | `ARRAYCOMPACT(array)` |
| ARRAYFLATTEN | `ARRAYFLATTEN(array)` |
| ARRAYSLICE | `ARRAYSLICE(array, start, [end])` |

## Regex
| Function | Syntax |
|----------|--------|
| REGEX_MATCH | `REGEX_MATCH(string, pattern)` |
| REGEX_EXTRACT | `REGEX_EXTRACT(string, pattern)` |
| REGEX_REPLACE | `REGEX_REPLACE(string, pattern, replacement)` |
