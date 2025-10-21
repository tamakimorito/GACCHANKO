

import React, { useState, useCallback, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// ========= TYPE DEFINITIONS =========
type DataRow = { [key: string]: string };
// FIX: Changed _jirife and _smayell to be string literals to conform to the DataRow index signature.
type AggregatedRow = DataRow & { _jirife: '0' | '1'; _smayell: '0' | '1'; };
type CustomerDataMap = Map<string, AggregatedRow>;
type ValidationResult = { valid: boolean; message: string; missingHeaders?: string[] };
type ConflictError = { key: string; conflicts: { header: string; values: Set<string> }[] };
type ProcessingErrors = {
    contractFile: ValidationResult | null;
    dataFile: ValidationResult | null;
    unmatched: string[];
    conflicts: ConflictError[];
};
type FileState = {
    file: File | null;
    data: DataRow[] | null;
    headers: string[] | null;
    validation: ValidationResult | null;
};

// ========= CONSTANTS =========
const REQUIRED_CONTRACT_HEADERS = ['契約ID'];
const REQUIRED_DATA_HEADERS = ['KeiyakuNO', 'KakutokuBashoName', 'ShouhinName_OP', 'Authority'];
const NEW_COLUMN_HEADERS = ['販路', 'オーソリー結果', 'ジライフ安心サポート', 'Sma-yell', '承認ID'];


// ========= UTILITY FUNCTIONS =========
const normHeaderForValidation = (s: string): string =>
    (s ?? '').replace(/^\uFEFF/, '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

const normalizeHeader = (header: string): string => {
    if (!header) return '';
    return header.trim().toLowerCase();
};

const normalizeKey = (key: string | null | undefined): string => {
    if (!key) return '';
    return String(key)
        .trim()
        .normalize('NFKC')
        .replace(/[－‐ー―]/g, '-')
        .toUpperCase()
        .replace(/[\s-]/g, '');
};

const parseOptions = (opString: string | null | undefined): { jirife: 0 | 1; smayell: 0 | 1 } => {
    if (!opString) return { jirife: 0, smayell: 0 };

    const normalized = opString.normalize('NFKC');

    // Regex to find the term if it's NOT followed by (0) or （0）
    const jirifeRegex = /ジライフ安心サポート(?!\s*[(（]0[)）])/i;
    // For Sma-yell, also ignore case and various separators, more robustly.
    const smayellRegex = /s\s*m\s*a[\s_\-－‐ー―]*y\s*e\s*l\s*l(?!\s*[(（]0[)）])/i;

    return {
        jirife: jirifeRegex.test(normalized) ? 1 : 0,
        smayell: smayellRegex.test(normalized) ? 1 : 0,
    };
};

const getTodayDateString = (): string => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
};


// ========= ICON COMPONENTS =========
const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const UploadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
);


// ========= UI COMPONENTS =========
interface FileDropzoneProps {
    title: string;
    acceptedFormats: string;
    onFileSelect: (file: File) => void;
    fileState: FileState;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ title, acceptedFormats, onFileSelect, fileState }) => {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const inputId = useMemo(
      () => ('upload-' + title)
            .normalize('NFKC')
            .replace(/\s+/g,'-')
            .replace(/[^A-Za-z0-9\-_.:]/g,''),
      [title]
    );

    const handleDrag = (e: React.DragEvent<HTMLLabelElement>, enter: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(enter);
    };

    const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
        handleDrag(e, false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFileSelect(e.dataTransfer.files[0]);
            e.dataTransfer.clearData();
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onFileSelect(e.target.files[0]);
        }
    };

    const borderColor = fileState.validation?.valid === true
        ? 'border-green-500'
        : fileState.validation?.valid === false
        ? 'border-red-500'
        : isDragging
        ? 'border-[#5aa62b]'
        : 'border-gray-300';

    return (
        <div className="w-full bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 text-center mb-4">{title}</h2>
            <label
                htmlFor={inputId}
                onClick={() => inputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed ${borderColor} rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors duration-200 focus-within:border-[#5aa62b] focus-within:ring-2 focus-within:ring-[#5aa62b]/50`}
                onDragEnter={(e) => handleDrag(e, true)}
                onDragLeave={(e) => handleDrag(e, false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
            >
                <div className="flex flex-col items-center justify-center text-center p-4">
                    <UploadIcon className="w-8 h-8 mb-3 text-gray-400" />
                    {fileState.file ? (
                        <>
                            <p className="font-medium text-gray-700 break-all">{fileState.file.name}</p>
                            <p className="text-xs text-gray-500 mt-1">{`(${(fileState.file.size / 1024).toFixed(2)} KB)`}</p>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-gray-600"><span className="font-semibold text-[#5aa62b]">ファイルを選択</span> or ドラッグ&ドロップ</p>
                            <p className="text-xs text-gray-500 mt-1">{acceptedFormats.toUpperCase().split(',').join(' / ')}</p>
                        </>
                    )}
                </div>
                <input ref={inputRef} id={inputId} type="file" className="sr-only" accept={acceptedFormats} onChange={handleFileChange} />
            </label>
            {fileState.validation && (
                <div className={`mt-3 p-3 rounded-md text-sm ${fileState.validation.valid ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    <div className="flex items-start">
                        {fileState.validation.valid ? <CheckIcon className="w-5 h-5 mr-2 flex-shrink-0 text-green-600" /> : <XIcon className="w-5 h-5 mr-2 flex-shrink-0 text-red-600" />}
                        <div>
                            <p className="font-medium">{fileState.validation.message}</p>
                            {fileState.validation.missingHeaders && (
                                <p className="text-xs mt-1">不足ヘッダー: {fileState.validation.missingHeaders.join(', ')}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


// ========= MAIN APP COMPONENT =========
export default function App() {
    const [contractFileState, setContractFileState] = useState<FileState>({ file: null, data: null, headers: null, validation: null });
    const [dataFileState, setDataFileState] = useState<FileState>({ file: null, data: null, headers: null, validation: null });
    const [errors, setErrors] = useState<ProcessingErrors>({ contractFile: null, dataFile: null, unmatched: [], conflicts: [] });
    const [isLoading, setIsLoading] = useState(false);
    const [resultData, setResultData] = useState<DataRow[] | null>(null);

    const resetState = useCallback(() => {
        setResultData(null);
        setErrors({ contractFile: null, dataFile: null, unmatched: [], conflicts: [] });
    }, []);
    
    const handleFileParse = useCallback((file: File, requiredHeaders: string[], setState: React.Dispatch<React.SetStateAction<FileState>>, isContractFile = false) => {
        const fileExtension = file.name.split('.').pop()?.toLowerCase();
        
        const processData = (parsedData: DataRow[]) => {
            const headers = parsedData.length > 0 ? Object.keys(parsedData[0]) : [];
            let missingHeaders: string[];

            if (isContractFile) {
                const contractIdCanonical = '契約ID';
                const hasContractId = headers.some(h => normHeaderForValidation(h) === normHeaderForValidation(contractIdCanonical));
                missingHeaders = hasContractId ? [] : [`${contractIdCanonical}（BOM/全角/空白の可能性あり）`];
            } else {
                const normalizedHeaders = headers.map(normalizeHeader);
                missingHeaders = requiredHeaders.filter(rh => !normalizedHeaders.includes(normalizeHeader(rh)));
            }

            if (missingHeaders.length > 0) {
                setState({ file, data: null, headers: null, validation: { valid: false, message: '必須ヘッダーが不足しています', missingHeaders } });
            } else {
                setState({ file, data: parsedData, headers, validation: { valid: true, message: 'ファイルは有効です' } });
            }
        };

        if (fileExtension === 'csv') {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                encoding: "Shift-JIS",
                complete: (results: { data: DataRow[] }) => processData(results.data),
                error: (err: any) => setState({ file, data: null, headers: null, validation: { valid: false, message: `CSV解析エラー: ${err.message}` } })
            });
        } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target!.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                    processData(jsonData as DataRow[]);
                } catch (err: any) {
                    setState({ file, data: null, headers: null, validation: { valid: false, message: `XLSX解析エラー: ${err.message}` } })
                }
            };
            reader.readAsArrayBuffer(file);
        } else {
            setState({ file, data: null, headers: null, validation: { valid: false, message: '無効なファイル形式です' } });
        }
    }, []);
    
    const handleContractFileSelect = useCallback((file: File) => {
        resetState();
        handleFileParse(file, REQUIRED_CONTRACT_HEADERS, setContractFileState, true);
    }, [resetState, handleFileParse]);

    const handleDataFileSelect = useCallback((file: File) => {
        resetState();
        handleFileParse(file, REQUIRED_DATA_HEADERS, setDataFileState);
    }, [resetState, handleFileParse]);

    const handleGenerate = () => {
        if (!contractFileState.data || !dataFileState.data) {
            return;
        }
        setIsLoading(true);

        setTimeout(() => {
            const localErrors: ProcessingErrors = { contractFile: null, dataFile: null, unmatched: [], conflicts: [] };
            const dataMap: CustomerDataMap = new Map();
            const keyConflicts: Map<string, { header: string, values: Set<string> }[]> = new Map();
            const dataHeaderMap = new Map(dataFileState.headers!.map(h => [normalizeHeader(h), h]));
            const keiyakuNoHeader = dataHeaderMap.get(normalizeHeader('KeiyakuNO'))!;
            const kakutokuHeader = dataHeaderMap.get(normalizeHeader('KakutokuBashoName'))!;
            const authorityHeader = dataHeaderMap.get(normalizeHeader('Authority'))!;
            const opHeader = dataHeaderMap.get(normalizeHeader('ShouhinName_OP'))!;
            const shouninHeader = dataHeaderMap.get(normalizeHeader('ShouninIDZeus')) || null;

            for (const row of dataFileState.data!) {
                const key = normalizeKey(row[keiyakuNoHeader]);
                if (!key) continue;

                const opOptions = parseOptions(row[opHeader]);

                if (!dataMap.has(key)) {
                    // FIX: Convert numeric _jirife and _smayell to string to match AggregatedRow type.
                    dataMap.set(key, { ...row, _jirife: String(opOptions.jirife) as '0' | '1', _smayell: String(opOptions.smayell) as '0' | '1' });
                } else {
                    const existingRow = dataMap.get(key)!;
                    
                    const checkConflict = (header: string) => {
                        // FIX: Cast row values to string before calling trim, as they may be numbers or other types from XLSX parsing.
                        const existingValue = String(existingRow[header] ?? '').trim();
                        // FIX: Cast row values to string before calling trim, as they may be numbers or other types from XLSX parsing.
                        const newValue = String(row[header] ?? '').trim();
                        if (newValue && existingValue && newValue !== existingValue) {
                            let conflicts = keyConflicts.get(key) || [];
                            let headerConflict = conflicts.find(c => c.header === header);
                            if (!headerConflict) {
                                headerConflict = { header, values: new Set([existingValue]) };
                                conflicts.push(headerConflict);
                            }
                            headerConflict.values.add(newValue);
                            keyConflicts.set(key, conflicts);
                        }
                        if (!existingValue && newValue) {
                            // FIX: Ensure value is a string before assignment.
                            existingRow[header] = String(row[header] ?? '');
                            dataMap.set(key, existingRow);
                        }
                    };
                    checkConflict(kakutokuHeader);
                    checkConflict(authorityHeader);
                    if (shouninHeader) checkConflict(shouninHeader);

                    // FIX: Assign string '1' instead of number 1.
                    if (opOptions.jirife === 1) existingRow._jirife = '1';
                    if (opOptions.smayell === 1) existingRow._smayell = '1';
                }
            }

            localErrors.conflicts = Array.from(keyConflicts.entries()).map(([key, conflicts]) => ({ key, conflicts }));
            const newResultData: DataRow[] = [];
            const contractIdHeader = contractFileState.headers!.find(h => normHeaderForValidation(h) === normHeaderForValidation('契約ID'))!;

            for (const contractRow of contractFileState.data!) {
                const key = normalizeKey(contractRow[contractIdHeader]);
                const dataRow = dataMap.get(key);

                if (dataRow) {
                    newResultData.push({
                        ...contractRow,
                        // FIX: Ensure value is a string as it may be a different type from the file parser.
                        [NEW_COLUMN_HEADERS[0]]: String(dataRow[kakutokuHeader] ?? ''),
                        // FIX: Ensure value is a string as it may be a different type from the file parser.
                        [NEW_COLUMN_HEADERS[1]]: String(dataRow[authorityHeader] ?? ''),
                        [NEW_COLUMN_HEADERS[2]]: String(dataRow._jirife),
                        [NEW_COLUMN_HEADERS[3]]: String(dataRow._smayell),
                        // FIX: Ensure value is a string before calling .trim() as it might be a number or other type.
                        [NEW_COLUMN_HEADERS[4]]: (shouninHeader && (String(dataRow[shouninHeader] ?? '').trim())) || 'ERROR',
                    });
                } else {
                    if(key) localErrors.unmatched.push(contractRow[contractIdHeader]);
                    newResultData.push({
                        ...contractRow,
                        [NEW_COLUMN_HEADERS[0]]: '',
                        [NEW_COLUMN_HEADERS[1]]: '',
                        [NEW_COLUMN_HEADERS[2]]: '0',
                        [NEW_COLUMN_HEADERS[3]]: '0',
                        [NEW_COLUMN_HEADERS[4]]: 'ERROR',
                    });
                }
            }
            
            setResultData(newResultData);
            setErrors(localErrors);
            setIsLoading(false);
        }, 50);
    };

    const handleDownload = (format: 'csv' | 'xlsx') => {
        if (!resultData) return;
        const filename = `gacchanko_${getTodayDateString()}`;
        const worksheet = XLSX.utils.json_to_sheet(resultData);

        if (format === 'csv') {
            const csvString = XLSX.utils.sheet_to_csv(worksheet);
            const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvString], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `${filename}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'GACCHANKO');
            XLSX.writeFile(workbook, `${filename}.xlsx`);
        }
    };
    
    const handleDownloadErrors = () => {
        const errorRows: any[] = [];
        if(errors.unmatched.length > 0){
             errorRows.push({ type: '未一致', key: '契約ID', details: '顧客契約データに存在しません' });
             errors.unmatched.forEach(id => errorRows.push({ type: '未一致', key: id, details: '' }));
        }
        if(errors.conflicts.length > 0){
            errorRows.push({ type: '重複矛盾', key: '契約ID', details: '列: 競合する値' });
            errors.conflicts.forEach(conflict => {
                const details = conflict.conflicts.map(c => `${c.header}: [${Array.from(c.values).join(', ')}]`).join('; ');
                errorRows.push({ type: '重複矛盾', key: conflict.key, details });
            });
        }

        if (errorRows.length === 0) return;

        const csv = Papa.unparse(errorRows);
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `gacchanko_errors_${getTodayDateString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const hasErrors = useMemo(() => errors.unmatched.length > 0 || errors.conflicts.length > 0, [errors]);

    const ActionButton: React.FC<{ onClick: () => void; children: React.ReactNode; className?: string; disabled?: boolean }> = ({ onClick, children, className = '', disabled = false }) => (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`h-10 px-6 font-semibold rounded-lg transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#5aa62b] ${className} ${disabled ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-[#5aa62b] hover:bg-[#4a8c22] text-white'}`}
        >
            {children}
        </button>
    );

    return (
        <div className="flex flex-col min-h-screen">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16">
                    <h1 className="font-bangers text-3xl text-gray-800 tracking-wide">GACCHANKO</h1>
                    <span className="text-sm font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded-md">v1.06</span>
                </div>
            </header>

            <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
                <div className="max-w-5xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                        <FileDropzone title="1. 顧客契約CSV" acceptedFormats=".csv,.xlsx" onFileSelect={handleContractFileSelect} fileState={contractFileState} />
                        <FileDropzone title="2. 顧客契約データ" acceptedFormats=".csv,.xlsx" onFileSelect={handleDataFileSelect} fileState={dataFileState} />
                    </div>

                    <div className="text-center">
                        <ActionButton
                            onClick={handleGenerate}
                            disabled={!contractFileState.data || !dataFileState.data || isLoading}
                            className="w-full md:w-auto text-lg px-12 h-12"
                        >
                            {isLoading ? 'GACCHANKO中...' : 'GACCHANKO！'}
                        </ActionButton>
                    </div>
                
                    {resultData && (
                        <div className="mt-12 p-6 bg-white rounded-lg shadow-sm border border-gray-200 animate-fade-in">
                            <h2 className="text-xl font-semibold text-gray-900 mb-4 text-center">生成完了</h2>
                            {hasErrors ? (
                                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-left text-sm text-yellow-900">
                                    <h3 className="font-semibold mb-2">いくつかの問題が検出されました：</h3>
                                    <ul className="list-disc list-inside space-y-2">
                                        {errors.unmatched.length > 0 && (
                                            <li>
                                                <span className="font-semibold">{errors.unmatched.length}件</span>の未一致データ (顧客契約CSVにのみ存在)
                                                <div className="text-xs text-gray-600 mt-1 pl-5 font-mono break-all">{errors.unmatched.slice(0, 20).join(', ')}</div>
                                            </li>
                                        )}
                                        {errors.conflicts.length > 0 && (
                                            <li>
                                                <span className="font-semibold">{errors.conflicts.length}件</span>のキーで重複矛盾 (販路/オーソリー結果が異なる)
                                                <div className="text-xs text-gray-600 mt-1 pl-5 font-mono">{errors.conflicts.slice(0,5).map(c => `ID:${c.key} [${c.conflicts[0].header}]`).join(', ')}</div>
                                            </li>
                                        )}
                                    </ul>
                                    <div className="text-center mt-4">
                                        <button onClick={handleDownloadErrors} className="text-xs bg-yellow-200 hover:bg-yellow-300 text-yellow-800 font-medium px-3 py-1.5 rounded-md transition-colors">
                                            エラーリストをCSVでダウンロード
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-center text-green-700 bg-green-50 p-3 rounded-md mb-6">✔ エラーはありませんでした。</p>
                            )}
                            
                            <p className="text-center text-gray-600 mb-4">ダウンロードするファイル形式を選択してください。</p>
                            <div className="flex justify-center items-center gap-4">
                                <ActionButton onClick={() => handleDownload('csv')}>CSV形式</ActionButton>
                                <ActionButton onClick={() => handleDownload('xlsx')}>XLSX形式</ActionButton>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            <footer className="w-full text-center p-4 text-gray-500 text-sm">
                &copy;タマシステム 2025
            </footer>
        </div>
    );
}