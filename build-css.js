const tailwindcss = require('@tailwindcss/postcss');
const postcss = require('postcss');
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'public/css/input.css');
const outputFile = path.join(__dirname, 'public/css/styles.css');
const tailwindConfig = path.join(__dirname, 'tailwind.config.js');

fs.readFile(inputFile, (err, css) => {
  if (err) throw err;

  postcss([tailwindcss(tailwindConfig)])
    .process(css, { from: inputFile, to: outputFile })
    .then(result => {
      fs.writeFile(outputFile, result.css, () => true);
      if (result.map) {
        fs.writeFile(outputFile + '.map', result.map.toString(), () => true);
      }
      console.log('Successfully built Tailwind CSS.');
    })
    .catch(error => {
      console.error('Error building Tailwind CSS:', error);
    });
});
