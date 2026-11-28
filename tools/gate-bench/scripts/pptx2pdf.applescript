-- Converts one .pptx to PDF with Microsoft PowerPoint, for the gate bench (ADR-016 §5).
--   osascript pptx2pdf.applescript <deck.pptx> <deck.pdf> <file name of the deck>
-- The deck must have a file name that no other open presentation has: the script finds it by
-- name and closes only that one, without saving. A repair or access prompt makes it time out.
on run argv
  set inPath to item 1 of argv
  set outPath to item 2 of argv
  set wanted to item 3 of argv
  with timeout of 150 seconds
    tell application "Microsoft PowerPoint"
      open (POSIX file inPath)
      set found to 0
      repeat 120 times
        set n to count of presentations
        repeat with i from 1 to n
          if (name of presentation i) is wanted then set found to i
        end repeat
        if found > 0 then exit repeat
        delay 0.5
      end repeat
      if found is 0 then error "PowerPoint did not open " & wanted
      set problem to ""
      try
        save presentation found in (POSIX file outPath) as save as PDF
      on error message number code
        set problem to "PowerPoint could not save the PDF (" & code & "): " & message
      end try
      close presentation found saving no
      if problem is not "" then error problem
      return "ok"
    end tell
  end timeout
end run
