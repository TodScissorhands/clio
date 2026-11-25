import { expect, test } from "bun:test";
import { bookmarkRows } from "../src/epub/bookmarks";
import { commandLineMatches } from "../src/reader/clioIndex";
import { EPUB_READER_COMMANDS } from "../src/reader/interactions";
test("bookmark aliases resolve exact commands and preserve ambiguous prefixes", () => {
 for (const name of ["mark", "bookmark"]) expect(commandLineMatches(name, EPUB_READER_COMMANDS).every(c=>c.id!=="mark_location")).toBe(true);
 for (const name of ["marks", "bookmarks"]) expect(commandLineMatches(name, EPUB_READER_COMMANDS).map(c=>c.id)).toEqual(["show_bookmarks"]);
 expect(EPUB_READER_COMMANDS.some(c=>c.id==="mark_location")).toBe(false);
});
test("unknown bookmark records remain visible without navigable locations", () => {
 expect(bookmarkRows([null,{id:"a",label:"Chapter",cfi:"epubcfi(/6/2)",cfiModel:"future"},{id:"b",label:"Good",cfi:"epubcfi(/6/2)",cfiModel:"foliate-html-v1"}])).toEqual([
 {key:"unavailable:0",label:"Bookmark 1",cfi:undefined},{key:"a",label:"Chapter",cfi:undefined},{key:"b",label:"Good",cfi:"epubcfi(/6/2)"}]);
});
