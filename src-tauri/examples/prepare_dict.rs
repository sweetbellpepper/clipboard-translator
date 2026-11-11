//! 从 ECDICT 官方 stardict.db 构建译笺精简词库（含变形反查表）。
//!
//! 用法：
//!   cargo run --example prepare_dict -- <原始 stardict.db> <输出 ecdict.db>
//!   cargo run --example prepare_dict -- --query <ecdict.db> <word>   # 构建后抽查
//!
//! 输出库只保留查询用到的 11 列 + inflections(form→lemma) 表；
//! 官方 851MB 原库（含 definition 大字段与音频表）瘦身到约 200MB。

use clipboard_translator_lib::dict::parse_exchange;
use rusqlite::{Connection, OpenFlags};

fn query(path: &str, word: &str) -> Result<(), Box<dyn std::error::Error>> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut stmt = conn.prepare(
        "SELECT word, phonetic, translation, collins, oxford, tag, exchange FROM stardict WHERE word = ?1",
    )?;
    match stmt.query_row(rusqlite::params![word], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<i64>>(3)?,
            r.get::<_, Option<i64>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
        ))
    }) {
        Ok((w, ph, tr, co, ox, tag, ex)) => {
            println!("word: {w}");
            println!("phonetic: {}", ph.unwrap_or_default());
            println!("translation:\n{}", tr.unwrap_or_default());
            println!("collins: {co:?} oxford: {ox:?} tag: {}", tag.unwrap_or_default());
            println!("exchange: {}", ex.unwrap_or_default());
        }
        Err(_) => println!("未命中: {word}"),
    }
    if let Ok(lemma) = conn.query_row(
        "SELECT lemma FROM inflections WHERE form = ?1",
        rusqlite::params![word.to_lowercase()],
        |r| r.get::<_, String>(0),
    ) {
        println!("inflections: {word} -> {lemma}");
    }
    Ok(())
}

fn build(src: &str, dst: &str) -> Result<(), Box<dyn std::error::Error>> {
    let source = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let _ = std::fs::remove_file(dst);
    let out = Connection::open(dst)?;

    out.execute_batch(
        "PRAGMA journal_mode = OFF;
         PRAGMA synchronous = OFF;
         CREATE TABLE stardict (
             id INTEGER PRIMARY KEY,
             word TEXT NOT NULL UNIQUE,
             phonetic TEXT, definition TEXT, translation TEXT, pos TEXT,
             collins INTEGER DEFAULT 0, oxford INTEGER DEFAULT 0, tag TEXT,
             frq INTEGER DEFAULT 0, bnc INTEGER DEFAULT 0, exchange TEXT
         );
         CREATE TABLE inflections (form TEXT PRIMARY KEY, lemma TEXT NOT NULL);",
    )?;

    let mut stmt = source.prepare(
        "SELECT id, word, phonetic, definition, translation, pos, collins, oxford, tag, frq, bnc, exchange FROM stardict",
    )?;
    type Row = (i64, String, String, String, String, String, i64, i64, String, i64, i64, String);
    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            let g = |i: usize| -> Option<String> { r.get::<_, Option<String>>(i).ok().flatten() };
            let n = |i: usize| -> i64 { r.get::<_, Option<i64>>(i).ok().flatten().unwrap_or(0) };
            Ok((
                r.get::<_, i64>(0)?,
                g(1).unwrap_or_default(),
                g(2).unwrap_or_default(),
                g(3).unwrap_or_default(),
                g(4).unwrap_or_default(),
                g(5).unwrap_or_default(),
                n(6), n(7),
                g(8).unwrap_or_default(),
                n(9), n(10),
                g(11).unwrap_or_default(),
            ))
        })?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);
    println!("读取 {} 行", rows.len());

    out.execute("BEGIN", [])?;
    {
        let mut ins = out.prepare(
            "INSERT OR IGNORE INTO stardict (id, word, phonetic, definition, translation, pos, collins, oxford, tag, frq, bnc, exchange) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        )?;
        let mut inf = out.prepare("INSERT OR IGNORE INTO inflections (form, lemma) VALUES (?1, ?2)")?;
        let mut inf_count = 0usize;
        for row in &rows {
            ins.execute(rusqlite::params![
                row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8, row.9, row.10, row.11
            ])?;
            for (form, lemma) in parse_exchange(&row.1, &row.11) {
                inf.execute(rusqlite::params![form, lemma])?;
                inf_count += 1;
            }
        }
        println!("变形映射写入 {inf_count} 条（冲突自动忽略）");
    }
    out.execute("COMMIT", [])?;

    // 重新打开恢复正常 journal 模式，并做完整性抽查
    drop(out);
    let verify = Connection::open(dst)?;
    verify.execute_batch("PRAGMA journal_mode = DELETE;")?;
    let words: i64 = verify.query_row("SELECT COUNT(*) FROM stardict", [], |r| r.get(0))?;
    let infs: i64 = verify.query_row("SELECT COUNT(*) FROM inflections", [], |r| r.get(0))?;
    let apple: String = verify.query_row(
        "SELECT translation FROM stardict WHERE word = 'apple'",
        [],
        |r| r.get(0),
    )?;
    assert!(apple.contains("苹果"), "抽查 apple 释义失败: {apple}");
    println!("完成：stardict {words} 词条，inflections {infs} 行，抽查 apple 通过");
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--query") {
        query(&args[2], &args[3])?
    } else if args.len() == 3 {
        build(&args[1], &args[2])?
    } else {
        println!("用法：prepare_dict <原始 stardict.db> <输出 ecdict.db>\n      prepare_dict --query <ecdict.db> <word>");
    }
    Ok(())
}
