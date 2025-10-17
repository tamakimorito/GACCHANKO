# GACCHANKO - Development Rules & Policies

This document outlines the core, unchanging rules for the GACCHANKO application.

## Core Principles

1.  **Client-Side Only**: All file processing must occur within the user's browser. No data is ever sent to an external server.
2.  **Header-Based Mapping**: Column identification must rely on header names, not fixed column positions, to ensure robustness against changes in file structure.
3.  **Strict Normalization**: Key matching and header identification must use a consistent normalization process to handle variations in formatting (case, width, spacing, symbols).

## Key Policies

### Data Matching & Merging

*   **Primary Key**: The match is performed between `契約ID` (from the Customer Contract CSV) and `KeiyakuNO` (from the Customer Data file) after normalization.
*   **Output Structure**: The output file must contain all original columns from the Customer Contract CSV, in their original order, with the four new columns (`販路`, `オーソリー結果`, `ジライフ安心サポート`, `Sma-yell`) appended at the end.
*   **Input/Output Specification**: The input and output specifications (column names, column order, file extensions) are fixed and must not be changed to ensure backward compatibility.

### Duplicate Key Resolution

*   **Value Adoption**: When multiple entries exist for the same key in the Customer Data file, the value from the **first-encountered non-empty row** is used for `販路` and `オーソリー結果`.
*   **Conflict Reporting**: If multiple, *different*, non-empty values are found for the same key, the conflict is reported in the on-screen error summary. The file generation still proceeds using the "first-encountered" rule.

### Option Parsing (`ShouhinName_OP`)

*   **Normalization**: Parsing logic uses `NFKC` normalization to handle character width and other variations.
*   **Zero-Value Exclusion**: Options suffixed with `(0)` or `（0）` (e.g., `ジライフ安心サポート(0)`) are explicitly ignored and treated as if the option is not present (value `0`).
*   **Flexible Matching**: The `Sma-yell` match is case-insensitive and tolerates variations in spacing and hyphens (e.g., `Sma - yell`, `Ｓｍａ－ｙｅｌｌ`).
*   **Positive Match**: Any mention of the option without a `(0)` or `（0）` suffix is treated as present (value `1`).

### Error Handling

*   **Immediate Validation**: File validation (format, required headers) occurs immediately upon file upload.
*   **Comprehensive Summary**: A summary of all issues (missing headers, unmatched IDs, duplicate conflicts) is displayed after the "Generate" process is run.
*   **Unmatched IDs**: `契約ID`s from the contract file that are not found in the data file result in empty `販路`/`オーソリー結果` columns and `0` for the option columns. They are reported in the "unmatched" error summary.
