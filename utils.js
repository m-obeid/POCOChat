function is_aplhanumeric(c){
    var x = c.charCodeAt();
  return ((x>=65&&x<=90)||(x>=97&&x<=122)||(x>=48&&x<=57))?true:false;
}

exports.whatsappStyles = (format,wildcard, opTag, clTag) => {
    if (exports.allSame(format, wildcard)) {
        return format;
    }
    var indices = [];
    for(var i = 0; i < format.length; i++) {
        if (format[i] === wildcard) {
            if(indices.length%2)
                (format[i-1]==" ")?null:((typeof(format[i+1])=="undefined")?indices.push(i):(is_aplhanumeric(format[i+1])?null:indices.push(i)));
            else
                (typeof(format[i+1])=="undefined")?null:((format[i+1]==" ")?null:(typeof(format[i-1])=="undefined")?indices.push(i):((is_aplhanumeric(format[i-1]))?null:indices.push(i)));
        }
        else{
            (format[i].charCodeAt()==10 && indices.length % 2)?indices.pop():null;
        }
    }
    (indices.length % 2)?indices.pop():null;
    var e=0;
    indices.forEach(function(v,i){
        var t=(i%2)?clTag:opTag;
        v+=e;
        format=format.substr(0,v)+t+format.substr(v+1);
        e+=(t.length-1);
    });
    return format;
}

exports.allSame = (s, expectedChar="") => {
    if (expectedChar === "") {
        let n = s.length;
        for (let i = 1; i < n; i++)
            if (s[i] != s[0])
                return false;
    
        return true;
    }
    else {
        if (s.includes(expectedChar)) {
            let n = s.length;
            for (let i = 1; i < n; i++)
                if (s[i] != expectedChar)
                    return false;
            return true;
        }
        return false;
    }
};