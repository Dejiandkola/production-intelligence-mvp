/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const map = [
    { src: '../src/pages/Dashboard/Dashboard.jsx', dest: './src/app/page.jsx' },
    { src: '../src/pages/Admin/Tailors.jsx', dest: './src/app/tailors/page.jsx' },
    { src: '../src/pages/Admin/TaskTypes.jsx', dest: './src/app/rates/page.jsx' },
    { src: '../src/pages/Production/ItemList.jsx', dest: './src/app/production/page.jsx' },
    { src: '../src/pages/QC/ManageItemTasks.jsx', dest: './src/app/qc/item/[itemId]/page.jsx' },
    { src: '../src/pages/Completion/Receiving.jsx', dest: './src/app/receiving/page.jsx' }
];

map.forEach(({ src, dest }) => {
    const srcPath = path.resolve(__dirname, src);
    const destPath = path.resolve(__dirname, dest);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    let content = fs.readFileSync(srcPath, 'utf8');

    // Add use client
    content = '"use client";\n\n' + content;

    // Replace react-router hooks
    content = content.replace(/import \{([^}]*)useNavigate([^}]*)\} from 'react-router-dom';/g, "import { $1useRouter$2 } from 'next/navigation';");
    content = content.replace(/import \{([^}]*)useParams([^}]*)\} from 'react-router-dom';/g, "import { $1useParams$2 } from 'next/navigation';");

    // Handle mixed imports like { useParams, useNavigate } -> if either handled above breaks
    if (content.includes("react-router-dom")) {
        content = content.replace(/import \{([^}]*)\} from 'react-router-dom';/, (match, group1) => {
            let newImports = group1.replace('useNavigate', 'useRouter');
            return `import { ${newImports} } from 'next/navigation';`;
        });
    }

    content = content.replace(/const navigate = useNavigate\(\);/g, "const router = useRouter();");
    content = content.replace(/navigate\(/g, "router.push(");

    // Fix imports relative paths
    content = content.replace(/\.\.\/\.\.\//g, "@/");
    content = content.replace(/\.\.\//g, "@/");

    fs.writeFileSync(destPath, content);
    console.log(`Ported ${src} -> ${dest}`);
});
