const sortJSON = (obj) => {
    if (!obj || typeof obj !== 'object') return JSON.stringify(obj);
    const sortedKeys = Object.keys(obj).sort();
    const sortedObj = {};
    sortedKeys.forEach(key => sortedObj[key] = obj[key]);
    return JSON.stringify(sortedObj);
};

module.exports = { sortJSON };