const fs = require('fs');
let code = fs.readFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\public\\admin.js', 'utf8');
code = code.replace(/\{\s*option_label:\s*'N\/A',\s*option_value:\s*'N\/A',\s*is_fail_value:\s*false\s*\},/g, '');
fs.writeFileSync('c:\\Users\\buddhimas\\Desktop\\Safety-Inspection-Admin\\public\\admin.js', code);
console.log('Fixed admin.js');
