// =================================================================================
// CONFIGURACIÓN INICIAL Y MANEJO DE EVENTOS
// =================================================================================
const iterationsContainer = document.getElementById('iterations-container');
const solutionContainer = document.getElementById('solution-container');
const preprocessingLog = document.getElementById('preprocessing-log');

document.addEventListener('click', (e) => {
    if (e.target.id === 'generate-matrix-btn') generateMatrix();
    if (e.target.id === 'solve-btn') solve();
});

// =================================================================================
// GENERACIÓN Y LECTURA DE LA INTERFAZ
// =================================================================================
function generateMatrix() {
    const numVars = parseInt(document.getElementById('num-vars').value);
    const numConstraints = parseInt(document.getElementById('num-constraints').value);
    const objectiveCoeffsDiv = document.getElementById('objective-coeffs');
    const constraintsGridDiv = document.getElementById('constraints-grid');
    
    objectiveCoeffsDiv.innerHTML = 'Z = ';
    for (let i = 1; i <= numVars; i++) {
        objectiveCoeffsDiv.innerHTML += `<div class="coeff-input"><input type="number" class="obj-coeff" value="0"> X<sub>${i}</sub> ${i < numVars ? '+' : ''}</div>`;
    }

    constraintsGridDiv.innerHTML = '';
    for (let i = 1; i <= numConstraints; i++) {
        let rowHtml = `<div class="constraint-row form-group">`;
        for (let j = 1; j <= numVars; j++) {
            rowHtml += `<div class="coeff-input"><input type="number" class="constraint-coeff" value="0"> X<sub>${j}</sub> ${j < numVars ? '+' : ''}</div>`;
        }
        rowHtml += `<select class="constraint-op"><option value="<=">&le;</option><option value=">=">&ge;</option><option value="=">=</option></select><input type="number" class="constraint-rhs" value="0"></div>`;
        constraintsGridDiv.innerHTML += rowHtml;
    }
    document.getElementById('problem-input-section').classList.remove('hidden');
    document.getElementById('solve-section').classList.remove('hidden');
}

function parseInputs() {
    const numVars = parseInt(document.getElementById('num-vars').value);
    const objectiveType = document.querySelector('input[name="objective-type"]:checked').value;
    let objectiveCoeffs = Array.from(document.querySelectorAll('.obj-coeff')).map(inp => parseFloat(inp.value) || 0);
    const constraintRows = document.querySelectorAll('.constraint-row');
    let constraints = [], constraintTypes = [], rhs = [];

    constraintRows.forEach(row => {
        constraints.push(Array.from(row.querySelectorAll('.constraint-coeff')).map(inp => parseFloat(inp.value) || 0));
        constraintTypes.push(row.querySelector('.constraint-op').value);
        rhs.push(parseFloat(row.querySelector('.constraint-rhs').value) || 0);
    });

    return { numVars, objectiveType, objectiveCoeffs, constraints, constraintTypes, rhs };
}

// =================================================================================
// CONTROLADOR PRINCIPAL Y LÓGICA DE RESOLUCIÓN
// =================================================================================
function solve() {
    document.getElementById('output-section').classList.remove('hidden');
    iterationsContainer.innerHTML = '';
    solutionContainer.innerHTML = '';
    preprocessingLog.innerHTML = '<h3>Pre-procesamiento</h3>';

    try {
        let { numVars, objectiveType, objectiveCoeffs, constraints, constraintTypes, rhs } = parseInputs();
        
        // Pre-procesamiento para RHS negativos
        for (let i = 0; i < constraints.length; i++) {
            if (rhs[i] < 0) {
                preprocessingLog.innerHTML += `<p><strong>Aviso:</strong> La restricción ${i + 1} se multiplicó por -1 para tener RHS no-negativo.</p>`;
                rhs[i] *= -1;
                constraints[i] = constraints[i].map(c => c * -1);
                if (constraintTypes[i] === '<=') constraintTypes[i] = '>=';
                else if (constraintTypes[i] === '>=') constraintTypes[i] = '<=';
            }
        }
        
        const isMinimize = objectiveType === 'minimize';
        const selectedMethod = document.getElementById('solve-method').value;
        
        // Convertir problema de minimización a maximización si es necesario para el algoritmo
        // Max(Z) = -Min(-Z). Trabajaremos maximizando.
        const effectiveObjectiveCoeffs = isMinimize ? objectiveCoeffs.map(c => c * -1) : objectiveCoeffs;
        
        switch (selectedMethod) {
            case 'simplex':
                solveWithStandardSimplex(numVars, effectiveObjectiveCoeffs, constraints, constraintTypes, rhs, isMinimize);
                break;
            case 'big-m':
                 solveWithBigM(numVars, effectiveObjectiveCoeffs, constraints, constraintTypes, rhs, isMinimize);
                break;
            case 'two-phase':
                solveWithTwoPhases(numVars, effectiveObjectiveCoeffs, constraints, constraintTypes, rhs, isMinimize);
                break;
        }
    } catch (error) {
        solutionContainer.innerHTML = `<p style="color: red;"><strong>Error:</strong> ${error.message}</p>`;
        console.error(error);
    }
}

// =================================================================================
// IMPLEMENTACIÓN DE LOS MÉTODOS DE SOLUCIÓN
// =================================================================================

function solveWithStandardSimplex(numVars, objectiveCoeffs, constraints, constraintTypes, rhs, isMinimize) {
    iterationsContainer.innerHTML += '<h3>Resolviendo con el Método Simplex Estándar</h3>';
    if (!constraintTypes.every(t => t === '<=')) {
        solutionContainer.innerHTML = '<h2>Error de Método</h2><p>El método Simplex Estándar <strong>solo funciona con restricciones de tipo (&le;)</strong>. Por favor, utilice el método de Dos Fases o Gran M para este problema.</p>';
        return;
    }
    let { tableau, headers, basicVars } = buildInitialTableau(numVars, objectiveCoeffs, constraints, constraintTypes, rhs);
    runSimplex(tableau, headers, basicVars, 'simplex', 'Iteración', isMinimize);
}

function solveWithTwoPhases(numVars, objectiveCoeffs, constraints, constraintTypes, rhs, isMinimize) {
    iterationsContainer.innerHTML += '<h3>Resolviendo con el Método de Dos Fases</h3>';
    let { tableau, headers, basicVars, numArtificial } = buildInitialTableau(numVars, objectiveCoeffs, constraints, constraintTypes, rhs);

    if (numArtificial === 0) {
        iterationsContainer.innerHTML += '<p>No se requieren variables artificiales. Se procede con el Simplex estándar.</p>';
        runSimplex(tableau, headers, basicVars, 'simplex', 'Iteración', isMinimize);
        return;
    }

    // --- FASE 1 ---
    iterationsContainer.innerHTML += '<h4>Inicio de Fase 1: Minimizar la suma de variables artificiales</h4>';
    let phase1Tableau = JSON.parse(JSON.stringify(tableau)).slice(0, -1);
    
    // Construir la fila R (función objetivo de la Fase 1)
    const rRow = new Array(headers.length).fill(0);
    rRow[0] = '-R';
    for (let i = 0; i < basicVars.length; i++) {
        if (basicVars[i].name.startsWith('A')) {
            for (let j = 1; j < phase1Tableau[i].length; j++) {
                rRow[j] -= phase1Tableau[i][j];
            }
        }
    }
    phase1Tableau.push(rRow);
    
    // Ejecutar Simplex en Fase 1
    runSimplex(phase1Tableau, headers, basicVars, 'simplex', 'Fase 1 - Iteración', true); // Siempre se minimiza R
    
    const rValue = phase1Tableau[phase1Tableau.length - 1][phase1Tableau[0].length - 1];
    if (Math.abs(rValue) > 1e-6) {
        solutionContainer.innerHTML = `<h2>Solución Final</h2><p>El problema es <strong>infactible</strong>. La Fase 1 terminó con un valor de R = ${rValue.toFixed(4)}, que no es cero.</p>`;
        return;
    }

    // --- FASE 2 ---
    iterationsContainer.innerHTML += '<h4>Inicio de Fase 2: Optimizar la función objetivo original</h4>';
    
    // Eliminar columnas de variables artificiales
    let artColsIndexes = [];
    headers.forEach((h, i) => { if (h.startsWith('A')) artColsIndexes.push(i); });
    
    let phase2Tableau = phase1Tableau.slice(0, -1).map(row => row.filter((_, i) => !artColsIndexes.includes(i)));
    let phase2Headers = headers.filter((_, i) => !artColsIndexes.includes(i));

    // Construir la nueva fila Z para la Fase 2
    const zRow = new Array(phase2Headers.length).fill(0);
    zRow[0] = 'Z';
    for (let i = 0; i < numVars; i++) {
        zRow[i + 1] = -objectiveCoeffs[i];
    }
    phase2Tableau.push(zRow);
    
    // Poner la fila Z en forma canónica
    for (let i = 0; i < basicVars.length; i++) {
        const bv = basicVars[i];
        const bvColIndexInPhase2 = phase2Headers.indexOf(bv.name);
        if (bvColIndexInPhase2 > 0) { // Si la variable básica no es artificial
            const zRow = phase2Tableau[phase2Tableau.length - 1];
            const factor = zRow[bvColIndexInPhase2];
            if (Math.abs(factor) > 1e-6) {
                for (let j = 1; j < zRow.length; j++) {
                    zRow[j] -= factor * phase2Tableau[i][j];
                }
            }
        }
    }
    
    runSimplex(phase2Tableau, phase2Headers, basicVars, 'simplex', 'Fase 2 - Iteración', isMinimize);
}

// NOTA: El método de la Gran M es conceptualmente más complejo de implementar con penalizaciones simbólicas.
// Una implementación numérica es más sencilla, pero Dos Fases es generalmente preferido por su estabilidad numérica.
// Por simplicidad y robustez, esta implementación se centrará en Dos Fases y Simplex Estándar.
// La función solveWithBigM se deja como un marcador de posición.
function solveWithBigM(numVars, objectiveCoeffs, constraints, constraintTypes, rhs, isMinimize) {
     solutionContainer.innerHTML = '<h2>Método no Implementado</h2><p>El método de la Gran M es complejo y propenso a errores de redondeo. Se recomienda usar el <strong>Método de Dos Fases</strong> que es numéricamente más estable y siempre llega a la misma solución.</p>';
}


// =================================================================================
// LÓGICA DEL ALGORITMO SIMPLEX
// =================================================================================

function buildInitialTableau(numVars, objectiveCoeffs, constraints, constraintTypes, rhs) {
    let numSlack = 0, numSurplus = 0, numArtificial = 0;
    constraintTypes.forEach(op => {
        if (op === '<=') numSlack++;
        else if (op === '>=') { numSurplus++; numArtificial++; }
        else if (op === '=') numArtificial++;
    });

    const numTotalVars = numVars + numSlack + numSurplus + numArtificial;
    let tableau = Array(constraints.length).fill(0).map(() => Array(numTotalVars + 2).fill(0));
    let headers = ['Base', ...Array.from({length: numVars}, (_, i) => `X${i+1}`)];
    let sIdx = 1, eIdx = 1, aIdx = 1;

    // Crear cabeceras en orden: X, Holgura (s), Exceso (e), Artificial (A)
    for(let i=0; i<numSlack; i++) headers.push(`s${sIdx++}`);
    for(let i=0; i<numSurplus; i++) headers.push(`e${eIdx++}`);
    for(let i=0; i<numArtificial; i++) headers.push(`A${aIdx++}`);
    headers.push('RHS');
    
    let basicVars = [];
    sIdx = 1; eIdx = 1; aIdx = 1; // Reiniciar contadores
    
    for (let i = 0; i < constraints.length; i++) {
        // Coeficientes de las variables de decisión
        for (let j = 0; j < numVars; j++) tableau[i][j + 1] = constraints[i][j];
        
        // Lado derecho (RHS)
        tableau[i][numTotalVars + 1] = rhs[i];

        // Añadir variables de holgura, exceso y artificiales
        if (constraintTypes[i] === '<=') {
            const slackVarName = `s${sIdx++}`;
            const col = headers.indexOf(slackVarName);
            tableau[i][col] = 1;
            basicVars[i] = { name: slackVarName, row: i };
        } else if (constraintTypes[i] === '>=') {
            const surplusVarName = `e${eIdx++}`;
            const artVarName = `A${aIdx++}`;
            const surplusCol = headers.indexOf(surplusVarName);
            const artCol = headers.indexOf(artVarName);
            tableau[i][surplusCol] = -1;
            tableau[i][artCol] = 1;
            basicVars[i] = { name: artVarName, row: i };
        } else if (constraintTypes[i] === '=') {
            const artVarName = `A${aIdx++}`;
            const artCol = headers.indexOf(artVarName);
            tableau[i][artCol] = 1;
            basicVars[i] = { name: artVarName, row: i };
        }
    }
    
    // Fila de la función objetivo (Z)
    const zRow = new Array(numTotalVars + 2).fill(0);
    zRow[0] = 'Z';
    for(let i=0; i < numVars; i++) {
        // Se insertan negativos porque Z - CjXj = 0
        zRow[i+1] = -objectiveCoeffs[i];
    }
    tableau.push(zRow);

    return { tableau, headers, basicVars, numArtificial };
}

function runSimplex(tableau, headers, basicVars, methodType, titlePrefix, isMinimize) {
    let iteration = 1;
    const MAX_ITERATIONS = 50; // Para evitar bucles infinitos

    while (iteration < MAX_ITERATIONS) {
        const objectiveRow = tableau[tableau.length - 1];

        // 1. Encontrar la columna pivote (variable que entra a la base)
        // Para maximización, es el valor más negativo en la fila Z.
        let pivotCol = -1;
        let minVal = 0;
        for (let j = 1; j < objectiveRow.length - 1; j++) {
            if (objectiveRow[j] < minVal) {
                minVal = objectiveRow[j];
                pivotCol = j;
            }
        }

        // Condición de parada: Si no hay valores negativos, hemos llegado al óptimo.
        if (pivotCol === -1) {
            displayTableau(tableau, headers, `Tabla Final Óptima (${titlePrefix})`, basicVars);
            displaySolution(tableau, headers, basicVars, isMinimize);
            return;
        }

        // 2. Encontrar la fila pivote (variable que sale de la base) - Criterio del ratio mínimo
        let pivotRow = -1;
        let minRatio = Infinity;
        for (let i = 0; i < tableau.length - 1; i++) {
            const valInPivotCol = tableau[i][pivotCol];
            if (valInPivotCol > 1e-6) { // Usar una tolerancia para evitar división por cero
                const rhs = tableau[i][tableau[0].length - 1];
                const ratio = rhs / valInPivotCol;
                if (ratio < minRatio) {
                    minRatio = ratio;
                    pivotRow = i;
                }
            }
        }

        // Condición de no acotamiento: Si no hay ratio positivo, la solución no es acotada.
        if (pivotRow === -1) {
            solutionContainer.innerHTML = '<h2>Solución Final</h2><p>El problema tiene una <strong>solución no acotada</strong>.</p>';
            return;
        }
        
        // Mostrar la tabla antes de hacer el pivoteo, resaltando los elementos clave.
        displayTableau(tableau, headers, `${titlePrefix} ${iteration}`, basicVars, pivotRow, pivotCol);
        
        // 3. Realizar el pivoteo (operaciones de fila)
        const pivotElement = tableau[pivotRow][pivotCol];
        
        // a) Normalizar la fila pivote (dividirla por el elemento pivote)
        for (let j = 1; j < tableau[pivotRow].length; j++) {
            tableau[pivotRow][j] /= pivotElement;
        }

        // b) Actualizar las otras filas (incluida la fila Z)
        for (let i = 0; i < tableau.length; i++) {
            if (i !== pivotRow) {
                const factor = tableau[i][pivotCol];
                for (let j = 1; j < tableau[i].length; j++) {
                    tableau[i][j] -= factor * tableau[pivotRow][j];
                }
            }
        }
        
        // Actualizar la variable básica de la fila pivote
        basicVars[pivotRow] = { name: headers[pivotCol], row: pivotRow };
        
        iteration++;
    }

     if(iteration >= MAX_ITERATIONS) {
        solutionContainer.innerHTML = `<p style="color: orange;"><strong>Advertencia:</strong> Se alcanzó el límite de ${MAX_ITERATIONS} iteraciones. El proceso fue detenido.</p>`;
    }
}

// =================================================================================
// FUNCIONES DE VISUALIZACIÓN
// =================================================================================

function displayTableau(tableau, headers, title, basicVars, pivotRow, pivotCol) {
    let html = `<h3>${title}</h3><table><thead><tr>`;
    headers.forEach(h => html += `<th>${h}</th>`);
    html += '</tr></thead><tbody>';

    tableau.forEach((row, i) => {
        const isPivotRow = (i === pivotRow);
        // La fila Z no es una fila de variable básica
        const rowHeader = (i < tableau.length - 1) ? basicVars[i].name : 'Z';
        
        html += `<tr class="${isPivotRow ? 'pivot-row' : ''}"><td>${rowHeader}</td>`;
        
        row.slice(1).forEach((val, j) => {
            const isPivotCol = (j + 1 === pivotCol);
            const isPivotElement = isPivotRow && isPivotCol;
            let className = '';
            if (isPivotElement) className = 'pivot-element';
            else if (isPivotCol) className = 'pivot-col';
            
            html += `<td class="${className}">${formatNumber(val)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    iterationsContainer.innerHTML += html;
}

function displaySolution(tableau, headers, basicVars, isMinimize) {
    const finalZRow = tableau[tableau.length - 1];
    let optimalZ = finalZRow[finalZRow.length - 1];
    
    // Si el problema original era minimizar, el valor de Z en la tabla es -Z.
    if (isMinimize) {
        optimalZ *= -1;
    }

    let solution = {};
    const numVars = headers.filter(h => h.startsWith('X')).length;
    for (let i = 1; i <= numVars; i++) {
        solution[`X${i}`] = 0;
    }

    basicVars.forEach(bv => {
        if (bv.name.startsWith('X')) {
            solution[bv.name] = tableau[bv.row][tableau[0].length - 1];
        }
    });

    let html = `<h2>Solución Óptima Final</h2>`;
    html += `<p><strong>Valor Óptimo de Z = ${formatNumber(optimalZ)}</strong></p>`;
    html += '<ul>';
    for (const [variable, value] of Object.entries(solution)) {
        html += `<li><strong>${variable}</strong> = ${formatNumber(value)}</li>`;
    }
    html += '</ul>';

    solutionContainer.innerHTML = html;
}

function formatNumber(num) {
    // Evita problemas con -0.00 y formatea a 2 decimales para una vista limpia
    if (Math.abs(num) < 1e-6) return 0;
    return parseFloat(num.toFixed(4));
}