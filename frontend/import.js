/*
 * File import (paste pehle ki tarah chalta rahega).
 *   - "Paste EDI Data" panel: Import file button + file ko textarea par drag & drop
 *   - OSMImport.readTextFile(file, cb): text file / XML ko sahi encoding me padhta hai
 *     (BOM, UTF-16, XML declaration ka encoding, warna UTF-8 / Windows-1252)
 * Logic Validation panel (logic.js) isi ko XML import ke liye use karta hai.
 */
(function () {
    "use strict";

    function decodeBuffer(buffer) {
        var bytes = new Uint8Array(buffer.slice(0, 4));

        if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
            return new TextDecoder("utf-16le").decode(buffer);
        }
        if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
            return new TextDecoder("utf-16be").decode(buffer);
        }

        var head = new TextDecoder("latin1").decode(buffer.slice(0, 200));
        var match = /encoding=["']([^"']+)["']/i.exec(head);

        if (match) {
            try {
                return new TextDecoder(match[1]).decode(buffer);
            } catch (e) { /* neeche UTF-8 */ }
        }

        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch (e) {
            return new TextDecoder("windows-1252").decode(buffer);
        }
    }

    function readTextFile(file, callback) {
        var reader = new FileReader();

        reader.onload = function () {
            try {
                callback(null, decodeBuffer(reader.result));
            } catch (error) {
                callback(error);
            }
        };
        reader.onerror = function () {
            callback(reader.error || new Error("Could not read the file."));
        };

        reader.readAsArrayBuffer(file);
    }

    window.OSMImport = { readTextFile: readTextFile, decodeBuffer: decodeBuffer };

    function init() {
        var box = document.getElementById("ediInput");
        var footer = document.querySelector(".input-footer");
        var status = document.getElementById("statusMessage");

        if (!box || !footer || document.getElementById("importTextBtn")) return;

        var wrap = document.createElement("span");
        wrap.style.cssText = "display:inline-flex;gap:8px;align-items:center";

        var button = document.createElement("button");
        button.type = "button";
        button.id = "importTextBtn";
        button.textContent = "Import file";
        button.title = "Load a text / EDI file instead of pasting (paste still works)";

        var picker = document.createElement("input");
        picker.type = "file";
        picker.id = "importTextFile";
        picker.accept = ".txt,.edi,.x12,.834,.dat,.out,.csv,text/plain";
        picker.hidden = true;

        wrap.appendChild(button);
        wrap.appendChild(picker);
        footer.insertBefore(wrap, footer.firstChild);

        function setStatus(text) {
            if (status) status.textContent = text;
        }

        function load(file) {
            if (!file) return;

            readTextFile(file, function (error, text) {
                if (error) {
                    setStatus("Could not read " + file.name + ": " + error.message);
                    return;
                }

                box.value = text;
                box.dispatchEvent(new Event("input", { bubbles: true }));

                var lines = text.split(/\r\n|\r|\n/).length;
                var message = "Imported " + file.name + " (" +
                    Math.max(1, Math.round(file.size / 1024)) + " KB, " + lines + " lines).";

                if (/^\s*</.test(text) && /<\/?[A-Za-z]/.test(text.slice(0, 200))) {
                    message += " This looks like XML - use the XML panels below.";
                } else if (/INS[*]Y[*]|INS[*]N[*]/.test(text) &&
                           !/EE RECORD|DEPENDENT RECORD/.test(text)) {
                    message += " Raw 834 detected: it will be converted to the pipe format automatically on Process Data.";
                } else {
                    message += " Click Process Data.";
                }

                setStatus(message);
            });
        }

        button.addEventListener("click", function () { picker.click(); });

        picker.addEventListener("change", function () {
            load(picker.files && picker.files[0]);
            picker.value = "";
        });

        // File ko seedha text box par drop karna
        box.addEventListener("dragover", function (event) { event.preventDefault(); });
        box.addEventListener("drop", function (event) {
            var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) {
                event.preventDefault();
                load(file);
            }
        });
    }

    init();
})();
